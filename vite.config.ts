import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'path'

// The modules each bundle was built from, for the THIRD-PARTY-NOTICES cross-check
// in scripts/post-build.mjs (DR-009). node_modules/.tmp is git-ignored.
const MODULES_DIR = path.resolve(import.meta.dirname, 'node_modules/.tmp')

function recordModules(name: string): Plugin {
  // Packages a stylesheet imports by bare name (@import "tailwindcss") are resolved inside
  // the CSS compiler and never reach the module graph, so they are recorded from the source
  const cssImports = new Set<string>()
  return {
    name: `evalcull:record-modules-${name}`,
    apply: 'build',
    enforce: 'pre',
    transform(_code, id) {
      const file = id.split('?')[0]
      if (!file.endsWith('.css') || !existsSync(file)) return null
      // The file as written: other plugins may already have compiled the imports away
      for (const m of readFileSync(file, 'utf8').matchAll(/@import\s+["']([^"'./][^"']*)["']/g)) {
        cssImports.add(path.join(import.meta.dirname, 'node_modules', m[1], '(css import)'))
      }
      return null
    },
    generateBundle(_options, bundle) {
      const ids = new Set<string>(cssImports)
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk') for (const id of Object.keys(output.modules)) ids.add(id)
      }
      mkdirSync(MODULES_DIR, { recursive: true })
      writeFileSync(path.join(MODULES_DIR, `bundle-modules.${name}.json`), JSON.stringify([...ids].sort(), null, 2))
    },
  }
}

export default defineConfig(({ mode }) => {
  // npm run build:single: the one-file build of PRD §3.9, opened from file://
  const single = mode === 'single'
  return {
    base: single ? './' : '/',
    // The one file goes to its own folder, so npm run build (the type check) never replaces it (DR-037, D-112)
    build: { outDir: single ? 'dist-single' : 'dist' },
    plugins: [react(), tailwindcss(), ...(single ? [viteSingleFile(), recordModules('main')] : [])],
    worker: {
      plugins: () => (single ? [recordModules('worker')] : []),
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['tests/setup.ts'],
      include: ['tests/**/*.test.{ts,tsx}'],
    },
  }
})
