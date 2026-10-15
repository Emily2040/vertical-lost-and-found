/** Deterministic mechanical synthesis shared by live playback and offline capture. */
// Shared live/offline mix: +18 dB gain followed by brief peak compression.
// Compressor: -3 dB threshold, 2 dB knee, 12:1 ratio, 1 ms attack, 50 ms release;
// a shared -2 dB output trim preserves true-peak headroom after native make-up gain.
// Native WebAudio adds about 6 ms look-ahead latency. No export-only gain is used.
const MASTER_LEVEL = .8 * 10 ** (18 / 20);
export class ArchiveAudioEngine {
  constructor(){this.ctx=null;this._enabled=true;this.captureMode=false;this.eventLog=[];this.lastRailSoundTime=-1;this.masterLevel=MASTER_LEVEL;}
  get enabled(){return this._enabled;}
  set enabled(value){this._enabled=Boolean(value);if(this.ctx&&this.master&&!this.captureMode)this.master.gain.setTargetAtTime(this._enabled?this.masterLevel:0,this.ctx.currentTime,.008);}
  init(){if(this.ctx)return;const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return;this.ctx=new Ctx({sampleRate:48000});this._connectMaster();}
  _connectMaster(){
    this.master=this.ctx.createGain();this.master.gain.value=this._enabled?this.masterLevel:0;
    this.transientControl=this.ctx.createDynamicsCompressor();
    this.transientControl.threshold.value=-3;this.transientControl.knee.value=2;
    this.transientControl.ratio.value=12;this.transientControl.attack.value=.001;this.transientControl.release.value=.050;
    this.outputTrim=this.ctx.createGain();this.outputTrim.gain.value=10**(-2/20);
    this.master.connect(this.transientControl).connect(this.outputTrim).connect(this.ctx.destination);
  }
  resume(){if(!this.ctx)this.init();if(this.ctx?.state==='suspended')this.ctx.resume().catch(()=>{});}
  getStatus(){return !this.enabled?'muted':this.captureMode?'offline':this.ctx?.state==='running'?'running':'locked';}
  resetSchedule(clearLog=false){this.lastRailSoundTime=-1;if(clearLog)this.eventLog.length=0;}
  _seed(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
  logEvent(simTime,type,params={}){const event={...params,t:Number(simTime.toFixed(6)),type,seed:this._seed(`${type}:${Math.round(simTime*48000)}:${this.eventLog.length}`)};this.eventLog.push(event);return event;}
  trigger(simTime,type,params={}){
    if(type==='rail_slide'){if(simTime>=this.lastRailSoundTime&&simTime-this.lastRailSoundTime<=.18)return false;this.lastRailSoundTime=simTime;}
    const event=this.logEvent(simTime,type,params);
    if(this.captureMode||!this.enabled)return true;
    this.resume();if(this.ctx?.state==='running')this.playEvent(this.ctx.currentTime+.003,type,event);return true;
  }
  _pan(params){
    if(Number.isFinite(params.pan))return Math.max(-.6,Math.min(.6,params.pan));
    if(Number.isFinite(params.x))return Math.max(-.5,Math.min(.5,params.x/9));
    const destination=String(params.chute||params.target||'');return destination.includes('west')?-.3:destination.includes('east')?.3:0;
  }
  _output(source,pan){const stereo=this.ctx.createStereoPanner();stereo.pan.value=pan;source.connect(stereo).connect(this.master);}
  _envelope(gain,t,length,peak,attack=.003){
    const a=Math.min(attack,length*.25),tail=Math.min(.006,length*.1);
    gain.setValueAtTime(0,t);gain.linearRampToValueAtTime(peak,t+a);
    gain.exponentialRampToValueAtTime(.00001,t+length-tail);gain.linearRampToValueAtTime(0,t+length);
  }
  _noise(t,length,level,seed,low=1800,high=60,pan=0,attack=.004){
    const count=Math.ceil(length*this.ctx.sampleRate),buffer=this.ctx.createBuffer(1,count,this.ctx.sampleRate),samples=buffer.getChannelData(0);let state=seed||1;
    for(let i=0;i<count;i++){state^=state<<13;state^=state>>>17;state^=state<<5;samples[i]=((state>>>0)/4294967295)*2-1;}
    const source=this.ctx.createBufferSource();source.buffer=buffer;
    const hp=this.ctx.createBiquadFilter();hp.type='highpass';hp.frequency.value=high;hp.Q.value=.65;
    const lp=this.ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.value=low;lp.Q.value=.65;
    const gain=this.ctx.createGain();this._envelope(gain.gain,t,length,level,attack);
    source.connect(hp).connect(lp).connect(gain);this._output(gain,pan);source.start(t);source.stop(t+length+.002);
  }
  _ring(t,length,frequency,level,pan=0){
    const buffer=this.ctx.createBuffer(1,Math.ceil(length*this.ctx.sampleRate),this.ctx.sampleRate),data=buffer.getChannelData(0);
    for(let i=0;i<data.length;i++)data[i]=Math.sin(2*Math.PI*frequency*i/this.ctx.sampleRate);
    const source=this.ctx.createBufferSource(),gain=this.ctx.createGain();source.buffer=buffer;
    this._envelope(gain.gain,t,length,level,.0015);source.connect(gain);this._output(gain,pan);source.start(t);source.stop(t+length+.003);
  }
  _impact(t,seed,{body=95,level=.2,metal=false,pan=0}={}){
    this._noise(t,.10,level,seed,metal?5200:1100,metal?300:45,pan,.0015);
    this._ring(t,.16,body,level*.5,pan);
    const partials=metal?[6.31,10.73,17.13]:[1.71,2.59,3.83];
    partials.forEach((ratio,i)=>this._ring(t,.095-i*.016,body*ratio,level*(metal?.16:.08)/(i+1),pan));
  }
  playEvent(t,type,params={}){
    const seed=params.seed??this._seed(type),pan=this._pan(params);
    switch(type){
      case 'burst_open':
        this._noise(t,.38,.34,seed,1800,70,pan,.006);
        this._impact(t+.018,seed+1,{body:76,level:.26,pan});
        this._impact(t+.21,seed+2,{body:105,level:.10,metal:true,pan});break;
      case 'tray_tip':
        [0,.072,.155].forEach((offset,i)=>this._impact(t+offset,seed+i,{body:125+i*19,level:.14/(1+i*.25),metal:true,pan}));break;
      case 'notch_lock':
        this._impact(t,seed,{body:165,level:.23,metal:true,pan});
        this._impact(t+.043,seed+1,{body:135,level:.085,metal:true,pan});break;
      case 'notch_release':
        this._noise(t,.075,.18,seed,3500,400,pan,.002);
        this._impact(t+.032,seed+1,{body:140,level:.10,metal:true,pan});break;
      case 'latch_reject':
        this._impact(t,seed,{body:93,level:.23,metal:true,pan});
        this._impact(t+.065,seed+1,{body:76,level:.15,pan});break;
      case 'hatch_toggle':
        this._noise(t,.25,.23,seed,2400,250,pan,.012);
        this._impact(t+.22,seed+1,{body:params.open?118:84,level:.19,metal:true,pan});break;
      case 'payload_transfer':{
        const mass=Math.max(1,Math.min(100,params.mass||params.massKg||25));
        this._impact(t,seed,{body:Math.max(55,120-mass*.8),level:.20+mass*.001,pan});
        this._noise(t+.02,.17,.14,seed+1,850,35,pan,.006);break;}
      case 'chute_dispatch':
        this._noise(t,.72,.13,seed,2300,160,pan,.012);
        for(let i=0;i<7;i++)this._impact(t+i*.10,seed+i+1,{body:120-i*7,level:.13-i*.009,metal:true,pan:Math.max(-.6,Math.min(.6,pan+(i-3)*.025))});break;
      case 'jump':this._noise(t,.12,.13,seed,1600,250,pan,.006);break;
      case 'land':this._impact(t,seed,{body:86,level:.21,pan});this._noise(t+.025,.12,.10,seed+1,1200,120,pan,.004);break;
      case 'rail_slide':{
        const speed=Math.max(.1,Math.min(3,params.speed||1));
        this._noise(t,.21,.11+speed*.025,seed,1800+speed*180,180,pan,.009);
        this._impact(t+.055,seed+1,{body:150,level:.035,metal:true,pan});
        this._impact(t+.135,seed+2,{body:170,level:.027,metal:true,pan});break;}
      case 'garden_open':
        this._noise(t,3.1,.055,seed,1800,160,pan,.40);
        this._noise(t+.18,2.7,.035,seed+1,3400,700,-.25,.50);
        this._noise(t+.28,2.8,.035,seed+2,3100,600,.25,.55);
        this._impact(t,seed+3,{body:105,level:.09,metal:true,pan});break;
      default:break;
    }
  }
  async renderOffline(durationSeconds,events=this.eventLog){
    if(!Number.isFinite(durationSeconds)||durationSeconds<=0)throw new Error('Invalid audio duration');
    const context=new OfflineAudioContext(2,Math.round(durationSeconds*48000),48000),synth=new ArchiveAudioEngine();synth.ctx=context;synth._connectMaster();
    for(const event of events)if(event.t>=0&&event.t<durationSeconds)synth.playEvent(event.t,event.type,event);
    return context.startRendering();
  }
}
