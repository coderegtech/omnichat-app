import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@omnichat/database';
import {buildApp} from '../src/app.js';
import {resolve} from 'node:path';

it.runIf(process.env.TEST_CODING_DOCKER==='1'&&!!process.env.TEST_DATABASE_URL)('runs an approved command through the authenticated project API exactly once',async()=>{
 const previous=process.env.CODING_EXECUTOR;process.env.CODING_EXECUTOR='docker';
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});let userId:string|undefined;
 const app=await buildApp({db,logger:false,config:{host:'127.0.0.1',port:0,origins:['http://localhost:3210'],cookieSecure:false,sessionDays:1,uploadDir:resolve('work/uploads'),gatewayUrl:'http://localhost:9999/v1',allowNoAuth:true,overrides:{}}});
 try {
  const auth=(await app.inject({method:'POST',url:'/api/auth/register',payload:{name:'Command test',email:'command-'+randomUUID()+'@example.test',password:'fixture password 12345',client:'native'}})).json();
  userId=auth.user.id;const headers={authorization:'Bearer '+auth.token};
  const project=(await app.inject({method:'POST',url:'/api/projects',headers,payload:{name:'Command fixture'}})).json();
  const path='/api/projects/'+project.id+'/commands';
  const command={requestId:randomUUID(),program:'node',args:['-e','console.log("api-command-verified")'],approved:true,allowNetwork:false};
  expect((await app.inject({method:'POST',url:path,headers,payload:{...command,approved:false}})).statusCode).toBe(400);
  expect((await app.inject({method:'POST',url:path,headers,payload:{...command,allowNetwork:true}})).statusCode).toBe(400);
  const started=await app.inject({method:'POST',url:path,headers,payload:command});expect(started.statusCode,started.body).toBe(202);
  const duplicate=await app.inject({method:'POST',url:path,headers,payload:command});expect(duplicate.statusCode).toBe(200);expect(duplicate.json().id).toBe(started.json().id);
  let job=started.json();
  for(let i=0;i<150&&['queued','running'].includes(job.status);i++){await new Promise(resolve=>setTimeout(resolve,100));job=(await app.inject({url:path,headers})).json().items[0];}
  expect(job,JSON.stringify(job)).toMatchObject({status:'complete',exitCode:0,output:'api-command-verified\n'});
  expect(await db.codingCommand.count({where:{projectId:project.id}})).toBe(1);
 } finally {
  await app.close();if(userId)await db.user.delete({where:{id:userId}});await db.$disconnect();
  if(previous===undefined)delete process.env.CODING_EXECUTOR;else process.env.CODING_EXECUTOR=previous;
 }
},30000);
