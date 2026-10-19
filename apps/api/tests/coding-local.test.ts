import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rm,realpath,symlink} from 'node:fs/promises';
import {resolve,join,relative,sep} from 'node:path';
import {PrismaClient} from '@omnichat/database';
import {buildApp} from '../src/app.js';
import type {AppConfig} from '../src/config.js';

describe.skipIf(!process.env.TEST_DATABASE_URL).sequential('linked source folder integration',()=>{
  let db:PrismaClient;let app:Awaited<ReturnType<typeof buildApp>>;let root:string;let userId:string;let otherId:string;let token:string;let otherToken:string;
  const oldRoots=process.env.CODING_LOCAL_PROJECTS;const work=resolve('work');
  const email='linked-'+randomUUID()+'@example.test';
  const config:AppConfig={host:'127.0.0.1',port:0,origins:['http://localhost:3210'],cookieSecure:false,sessionDays:1,uploadDir:resolve('work/uploads'),gatewayUrl:'http://localhost:9999/v1',allowNoAuth:true,overrides:{}};
  beforeAll(async()=>{
    root=resolve(work,'linked-test-'+randomUUID());await mkdir(root,{recursive:true});root=await realpath(root);
    process.env.CODING_LOCAL_PROJECTS=JSON.stringify([{email,path:root}]);
    db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});app=await buildApp({db,config,logger:false});
    const register=async(address:string)=>(await app.inject({method:'POST',url:'/api/auth/register',payload:{name:'Linked fixture',email:address,password:'fixture password 12345',client:'native'}})).json();
    const first=await register(email);userId=first.user.id;token=first.token;
    const other=await register('other-'+randomUUID()+'@example.test');otherId=other.user.id;otherToken=other.token;
  });
  afterAll(async()=>{
    await app?.close();if(db){await db.user.deleteMany({where:{id:{in:[userId,otherId].filter(Boolean)}}});await db.$disconnect();}
    if(oldRoots===undefined)delete process.env.CODING_LOCAL_PROJECTS;else process.env.CODING_LOCAL_PROJECTS=oldRoots;
    const child=relative(work,root);if(child&&!child.startsWith('..'+sep)&&!child.startsWith('..'))await rm(root,{recursive:true,force:true});
  });
  const headers=()=>({authorization:'Bearer '+token});
  const req=(url:string,payload?:unknown,method=payload?'POST':'GET')=>app.inject({url,method:method as any,headers:headers(),...(payload?{payload}: {})});
  async function link(name:string,content='export const answer = 1;\n') {
    const folder=join(root,name);await mkdir(folder);await writeFile(join(folder,'index.js'),content);
    const response=await req('/api/projects/link',{path:folder,name});expect(response.statusCode).toBe(201);
    return {id:response.json().id,folder};
  }
  const detail=async(id:string)=>(await req('/api/projects/'+id)).json();
  const edit=async(id:string,path:string,content:string,baseRevision:number|null)=>
    req('/api/projects/'+id+'/files',{files:[{path,content,baseRevision}]});

  it('limits roots to assigned accounts and excludes credential/dependency files',async()=>{
    const folder=join(root,'first');await mkdir(join(folder,'node_modules'),{recursive:true});
    await writeFile(join(folder,'.env'),'SECRET=not-for-model');
    await writeFile(join(folder,'node_modules','dep.js'),'skip');
    await writeFile(join(folder,'README.md'),'# Project');
    expect((await req('/api/projects/local-roots')).json().items).toHaveLength(1);
    expect((await app.inject({url:'/api/projects/local-roots',headers:{authorization:'Bearer '+otherToken}})).json().items).toHaveLength(0);
    expect((await app.inject({method:'POST',url:'/api/projects/link',headers:{authorization:'Bearer '+otherToken},payload:{path:folder}})).statusCode).toBe(403);
    expect((await req('/api/projects/link',{path:resolve(root,'..')})).statusCode).toBe(403);
    const linked=await req('/api/projects/link',{path:folder});expect(linked.statusCode).toBe(201);
    const data=await detail(linked.json().id);expect(data.project.source).toBe('linked');
    expect(data.project.localManifest).toBeUndefined();expect(data.files.map((file:any)=>file.path)).toEqual(['README.md']);
    expect((await req('/api/projects/link',{path:folder})).statusCode).toBe(409);
    expect((await app.inject({url:'/api/projects/'+linked.json().id,headers:{authorization:'Bearer '+otherToken}})).statusCode).toBe(404);
  });
  it('publishes only the reviewed version, including creations and deletions',async()=>{
    const {id,folder}=await link('publish');
    expect((await edit(id,'index.js','export const answer = 42;\n',1)).statusCode).toBe(200);
    expect((await edit(id,'test.js','console.log(42);\n',null)).statusCode).toBe(200);
    const review=(await req('/api/projects/'+id+'/publish-preview')).json();
    expect(review.changes.map((item:any)=>item.operation).sort()).toEqual(['create','update']);
    expect(await readFile(join(folder,'index.js'),'utf8')).toContain('= 1;');
    expect((await req('/api/projects/'+id+'/publish',{version:review.version})).statusCode).toBe(400);
    expect((await req('/api/projects/'+id+'/publish',{approved:true,version:'0'.repeat(64)})).statusCode).toBe(409);
    expect((await req('/api/projects/'+id+'/publish',{approved:true,version:review.version})).json()).toEqual({written:2,deleted:0});
    expect(await readFile(join(folder,'index.js'),'utf8')).toContain('= 42;');
    expect((await req('/api/projects/'+id+'/files',{path:'test.js',baseRevision:1},'DELETE')).statusCode).toBe(200);
    const deletion=(await req('/api/projects/'+id+'/publish-preview')).json();
    expect(deletion.changes[0].operation).toBe('delete');
    expect((await req('/api/projects/'+id+'/publish',{approved:true,version:deletion.version})).json().deleted).toBe(1);
    await expect(readFile(join(folder,'test.js'))).rejects.toThrow();
  });
  it('rejects external edits before writing any files',async()=>{
    const {id,folder}=await link('conflict');
    await edit(id,'index.js','workspace change\n',1);await edit(id,'a-new.js','new\n',null);
    const review=(await req('/api/projects/'+id+'/publish-preview')).json();
    await writeFile(join(folder,'index.js'),'external editor\n');
    const publish=await req('/api/projects/'+id+'/publish',{approved:true,version:review.version});
    expect(publish.statusCode).toBe(409);expect(publish.json().error.code).toBe('LOCAL_CONFLICT');
    expect(await readFile(join(folder,'index.js'),'utf8')).toBe('external editor\n');
    await expect(readFile(join(folder,'a-new.js'))).rejects.toThrow();
  });
  it('invalidates a review when saved workspace files change',async()=>{
    const {id,folder}=await link('stale-preview');await edit(id,'index.js','version 2\n',1);
    const preview=(await req('/api/projects/'+id+'/publish-preview')).json();
    await edit(id,'index.js','version 3\n',2);
    expect((await req('/api/projects/'+id+'/publish',{approved:true,version:preview.version})).statusCode).toBe(409);
    expect(await readFile(join(folder,'index.js'),'utf8')).toContain('= 1;');
  });
  it('syncs disk state with new revisions and rejects proposals against the old snapshot',async()=>{
    const {id,folder}=await link('sync');
    const run=await db.codingRun.create({data:{projectId:id,requestId:randomUUID(),prompt:'test',modelId:'fixture',status:'awaiting_review'}});
    await writeFile(join(folder,'index.js'),'updated externally\n');
    const synced=await req('/api/projects/'+id+'/sync',{});expect(synced.statusCode).toBe(200);
    expect(synced.json().files[0].revision).toBe(2);expect(synced.json().files[0].content).toBe('updated externally\n');
    expect((await db.codingRun.findUniqueOrThrow({where:{id:run.id}})).status).toBe('rejected');
    expect((await edit(id,'index.js','stale\n',1)).statusCode).toBe(409);
  });
  it('does not follow a junction outside the assigned folder',async()=>{
    const outside=join(root,'outside');await mkdir(outside);await writeFile(join(outside,'private.txt'),'not in attached project');
    const container=join(root,'junction-project');await mkdir(container);
    await symlink(outside,join(container,'escape'),process.platform==='win32'?'junction':'dir');
    expect((await req('/api/projects/link',{path:join(container,'escape')})).statusCode).toBe(409);
    const response=await req('/api/projects/link',{path:container});expect(response.statusCode).toBe(201);
    expect((await detail(response.json().id)).files).toHaveLength(0);
  });
  it('reports uncertain database acknowledgement after disk writes explicitly',async()=>{
    const {id,folder}=await link('commit-uncertain');await edit(id,'index.js','saved\n',1);
    const preview=(await req('/api/projects/'+id+'/publish-preview')).json();
    const transaction=db.$transaction.bind(db);
    const spy=vi.spyOn(db,'$transaction').mockImplementationOnce((async(...args:any[])=>{
      await (transaction as any)(...args);throw new Error('Simulated lost commit acknowledgement');
    }) as any);
    try {
      const result=await req('/api/projects/'+id+'/publish',{approved:true,version:preview.version});
      expect(result.statusCode).toBe(409);expect(result.json().error.code).toBe('LOCAL_PARTIAL');
      expect(await readFile(join(folder,'index.js'),'utf8')).toBe('saved\n');
    } finally {spy.mockRestore();}
  });
});
