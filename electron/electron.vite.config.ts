import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import { config } from 'dotenv'

// Load .env at build time so we can inject values into the bundle
config({ path: resolve(__dirname, '.env') })

export default defineConfig({
  main: {
    define: {
      'process.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_URL || ''),
      'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''),
      'process.env.COASTY_BACKEND_URL': JSON.stringify(process.env.COASTY_BACKEND_URL || ''),
    },
    build: {
      rollupOptions: {
        // Native .node binaries MUST stay external — Rollup can't bundle
        // them, and inlining the platform-specific resolver below would
        // hard-code a single platform into the build. Each entry here MUST
        // also appear in `electron-builder.yml` under `files:` (and under
        // `asarUnpack:` if it ships .node binaries) — otherwise the packaged
        // app crashes with "Cannot find module '<name>'" at first call.
        // The packaging-deps.test.ts file enforces both halves of that
        // contract.
        external: [
          'puppeteer-core',
          '@nut-tree-fork/libnut',
          '@nut-tree-fork/libnut-win32',
          '@nut-tree-fork/libnut-darwin',
          '@nut-tree-fork/libnut-linux',
        ]
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    },
    plugins: [
      react(),
      // Strip `crossorigin` from built HTML — it breaks script loading
      // when Electron loads from file:// protocol inside an asar archive
      {
        name: 'strip-crossorigin',
        enforce: 'post' as const,
        transformIndexHtml(html: string) {
          return html.replace(/ crossorigin/g, '')
        }
      }
    ],
    css: {
      postcss: {
        plugins: [tailwindcss, autoprefixer]
      }
    },
    server: {
      proxy: {
        '/api': {
          target: process.env.COASTY_BACKEND_URL || 'http://localhost:8001',
          changeOrigin: true,
        }
      }
    }
  }
})
