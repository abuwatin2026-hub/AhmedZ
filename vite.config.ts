import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => ({
  base: command === 'build' ? './' : (mode === 'capacitor' ? './' : '/'),
  plugins: [
    react(),
    {
      name: 'webview-click-noop',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url || '';
          if (url.startsWith('/api/webviewClick')) {
            res.statusCode = 204;
            res.end();
            return;
          }
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url || '';
          if (url.startsWith('/api/webviewClick')) {
            res.statusCode = 204;
            res.end();
            return;
          }
          next();
        });
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(path.dirname(fileURLToPath(import.meta.url)), './'),
    },
  },
  build: {
    minify: 'esbuild',
    sourcemap: false,
    target: 'es2019',
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          supabase: ['@supabase/supabase-js'],
          capacitor: [
            '@capacitor/app',
            '@capacitor/core',
            '@capacitor/filesystem',
            '@capacitor-community/file-opener',
            '@capacitor/haptics',
            '@capacitor/share',
          ],
        },
      },
    },
  },
  esbuild: {
    drop: mode === 'production' ? ['console', 'debugger'] : [],
    legalComments: 'none',
  },
  server: {
    port: 5174,
    strictPort: false,
  },
}))
