import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import type { ModelOverrides } from '@omnichat/omniroute';

export interface AppConfig { host:string; port:number; origins:string[]; cookieSecure:boolean; sessionDays:number; uploadDir:string; gatewayUrl:string; gatewayKey?:string; allowNoAuth:boolean; overrides:ModelOverrides; }
export function loadConfig():AppConfig {
  const origins=(process.env.WEB_ORIGINS ?? 'http://localhost:3000').split(',').map(v=>v.trim()).filter(Boolean);
  for(const origin of origins) if(new URL(origin).origin!==origin) throw new Error('WEB_ORIGINS must contain exact origins without trailing slashes.');
  const cookieSecure=process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV==='production';
  return {host:process.env.API_HOST??'0.0.0.0',port:Number(process.env.API_PORT??4000),origins,cookieSecure,sessionDays:Math.min(90,Math.max(1,Number(process.env.SESSION_DAYS??30))),uploadDir:resolve(process.env.UPLOAD_DIR??'data/uploads'),gatewayUrl:process.env.OMNIROUTE_BASE_URL??'http://127.0.0.1:20128/v1',gatewayKey:process.env.OMNIROUTE_API_KEY||undefined,allowNoAuth:process.env.OMNIROUTE_ALLOW_NO_AUTH==='true',overrides:process.env.OMNIROUTE_COMPATIBILITY_FILE?JSON.parse(readFileSync(process.env.OMNIROUTE_COMPATIBILITY_FILE,'utf8')):{}};
}
