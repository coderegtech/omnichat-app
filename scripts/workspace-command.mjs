import {spawn} from 'node:child_process';
try {process.loadEnvFile('.env');} catch (error) {if(error.code!=='ENOENT')throw error;}
const commands={
 build:[['--filter','@omnichat/api','build'],['--filter','@omnichat/web','build'],['--filter','@omnichat/desktop','build']],
 'db:generate':[['--filter','@omnichat/database','generate']],
 'db:migrate':[['--filter','@omnichat/database','migrate']],
 'db:seed':[['--filter','@omnichat/database','seed']],
 'db:test:migrate':[['--filter','@omnichat/database','migrate']],
 'test:integration':[['exec','vitest','run','apps/api']],
 'dev:desktop':[['--filter','@omnichat/desktop','dev']],
 'dev:mobile':[['--filter','@omnichat/mobile','dev']],
};
const task=process.argv[2];
if(!(task in commands))throw new Error('Unknown workspace command');
if(task==='test:integration'||task==='db:test:migrate') {
 if(!process.env.TEST_DATABASE_URL)throw new Error('Set TEST_DATABASE_URL to an isolated test database before running integration tests.');
 if(task==='db:test:migrate')process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
}
for(const args of commands[task]) {
 const result=await new Promise((resolve,reject)=>{
   const pnpmPath=process.env.npm_execpath;
   const child=pnpmPath&&/\.(c?js|mjs)$/.test(pnpmPath)
    ?spawn(process.execPath,[pnpmPath,...args],{stdio:'inherit',env:process.env})
    :spawn(process.platform==='win32'?'pnpm.cmd':'pnpm',args,{stdio:'inherit',env:process.env,shell:process.platform==='win32'});
   child.on('error',reject);child.on('exit',code=>resolve(code??1));
 });
 if(result!==0)process.exit(result);
}
