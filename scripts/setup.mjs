import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root = new URL('../',import.meta.url);
const env = new URL('.env',root);
if(existsSync(env)) { console.log('.env already exists; preserved existing configuration.'); }
else {
  const password=randomBytes(24).toString('hex');
  writeFileSync(env,readFileSync(new URL('.env.example',root),'utf8').replaceAll('replace-with-a-long-random-password',password),{mode:0o600});
  console.log(`Created ${fileURLToPath(env)} with a random database password. Configure your OmniRoute endpoint before starting.`);
}
