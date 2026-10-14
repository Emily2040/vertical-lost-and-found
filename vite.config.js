import { defineConfig } from 'vite';
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [{
    name: 'copy-runtime-assets',
    closeBundle() {
      // Runtime URLs are root-relative; Vite cannot discover these via imports.
      const destination = join(projectRoot, 'dist');
      for (const relative of ['contract.json', 'world.json', 'assets/models', 'assets/textures/pbr', 'assets/textures/provenance.json']) {
        const target = join(destination, relative);
        mkdirSync(dirname(target), { recursive: true });
        cpSync(join(projectRoot, relative), target, { recursive: true });
      }
    }
  }],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/.run/**', '**/renders/**', '**/captures/**']
    }
  },
  build: {
    target: 'esnext',
    outDir: 'dist'
  }
});
