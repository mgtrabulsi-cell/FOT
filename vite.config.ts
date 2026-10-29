import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');
  return {
    base: mode === 'native' ? '/' : env.VITE_BASE_PATH || './',
    build: { outDir: mode === 'native' ? 'dist-native' : 'dist' },
    plugins: [react(), {
      name: 'gamewire-offline',
      apply: 'build',
      generateBundle(_options, bundle) {
        if (mode === 'native') return;
        const assets = ['index.html', 'manifest.webmanifest', 'gamewire-mark.png', 'gamewire-mark-transparent.png', 'gamewire-pulse.png', 'gamewire-pwa.svg', ...Object.keys(bundle)];
        const version = createHash('sha256').update(assets.join('|') + readFileSync('public/sw.js', 'utf8')).digest('hex').slice(0, 16);
        const config = { version, assets, publicApiOrigin: env.VITE_SUPABASE_URL ? new URL(env.VITE_SUPABASE_URL).origin : null };
        this.emitFile({ type: 'asset', fileName: 'sw.js', source: `self.GAMEWIRE_OFFLINE = ${JSON.stringify(config)};\n${readFileSync('public/sw.js', 'utf8')}` });
      },
    }],
  };
});
