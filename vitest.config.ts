import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
export default defineConfig({resolve:{alias:{'@':fileURLToPath(new URL('./apps/web',import.meta.url))}},esbuild:{jsx:'automatic'},test:{include:['packages/**/*.test.ts','apps/api/**/*.test.ts','apps/web/**/*.test.{ts,tsx}'],exclude:['**/node_modules/**','**/dist/**'],testTimeout:15000,environment:'node',env:{NODE_ENV:'test'}}});
