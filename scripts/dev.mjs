import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const children=[
 spawn(process.execPath,['--import','tsx','--watch','apps/api/src/index.ts'],{cwd:root,stdio:'inherit',env:process.env}),
 spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','0.0.0.0','--port',process.env.WEB_PORT||'3210'],{cwd:fileURLToPath(new URL('../apps/web/',import.meta.url)),stdio:'inherit',env:process.env})
];
let ending=false;
function shutdown(){if(ending)return;ending=true;children.forEach(child=>child.kill());}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
children.forEach(child=>child.on('exit',code=>{shutdown();process.exitCode=code||0;}));
