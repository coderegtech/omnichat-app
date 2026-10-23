import {defineConfig,devices} from '@playwright/test';
const baseURL=process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:3210';
export default defineConfig({testDir:'./apps/web/e2e',fullyParallel:false,workers:1,timeout:45000,expect:{timeout:10000},use:{baseURL,trace:'retain-on-failure',screenshot:'only-on-failure'},projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}],webServer:{command:`pnpm --filter @omnichat/web dev --port ${Number(new URL(baseURL).port)||3210}`,url:baseURL,reuseExistingServer:!process.env.CI,timeout:180000}});
