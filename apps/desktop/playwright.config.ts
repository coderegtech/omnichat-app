import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', testMatch: 'smoke.spec.ts', workers: 1, timeout: 30000 });
