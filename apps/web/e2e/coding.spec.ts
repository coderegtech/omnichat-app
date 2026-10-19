import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {CodingProject,CodingFile,CodingRun,CodingCommand} from '@omnichat/types';

async function fixture(page:Page,linked=false,multipleFiles=false) {
 const now=new Date().toISOString();
 const project:CodingProject={id:randomUUID(),name:'Fixture project',description:'Deterministic browser fixture',source:linked?'linked':'imported',localPath:linked?'C:/Fixture/project':null,createdAt:now,updatedAt:now};
 const files:CodingFile[]=[{id:randomUUID(),path:'index.js',content:'export const answer = 1;\n',revision:1,updatedAt:now}];
 if(multipleFiles)files.push({id:randomUUID(),path:'src/greeting.ts',content:'export const greeting = "Hello from the project";\n',revision:1,updatedAt:now});
 const runs:CodingRun[]=[];const commands:CodingCommand[]=[];const approvals:unknown[]=[];const publications:unknown[]=[];
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,method=req.method();
  const json=(body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(path==='/api/auth/me')return json({user:{id:'fixture-user',name:'Coding tester',email:'fixture@example.test'}});
  if(path==='/api/settings')return json({theme:'dark',defaultModel:'fixture/chat',favoriteModels:[],systemPrompt:'',streaming:true,animations:false});
  if(path==='/api/models')return json({models:[{id:'fixture/chat',name:'Fixture coder',provider:'Fixture',capabilities:{chat:true},availability:'unknown',metadataSource:'gateway'}],connection:{status:'connected',checkedAt:now},endpoints:[]});
  if(['/api/conversations','/api/folders'].includes(path))return json({items:[]});
  if(path==='/api/projects/local-roots')return json({items:[{path:'C:/Fixture',label:'Fixture root'}]});
  if(path==='/api/projects')return method==='POST'?json({...project,id:randomUUID(),name:req.postDataJSON().name},201):json({items:[project]});
  if(path.endsWith('/executor'))return json({available:true,image:'fixture-image'});
  if(path.endsWith('/publish-preview'))return json({version:'a'.repeat(64),changes:[{path:'index.js',operation:'update',before:'old disk source\n',after:files[0]!.content}]});
  if(path.endsWith('/publish')){publications.push(req.postDataJSON());return json({written:1,deleted:0});}
  if(path.endsWith('/commands')){
   if(method==='POST'){const body=req.postDataJSON();approvals.push(body);const command:CodingCommand={...body,id:randomUUID(),projectId:project.id,status:'complete',output:'fixture command passed\n',exitCode:0,createdAt:now,updatedAt:now};commands.unshift(command);return json(command,202);}
   return json({items:commands});
  }
  if(path.endsWith('/files')&&method==='POST'){
   for(const change of req.postDataJSON().files){const old=files.find(file=>file.path===change.path);if(old)Object.assign(old,{content:change.content,revision:old.revision+1});else files.push({id:randomUUID(),path:change.path,content:change.content,revision:1,updatedAt:now});}
   return json({items:files});
  }
  if(path.endsWith('/runs')&&method==='POST'){
   const body=req.postDataJSON();const run:CodingRun={...body,id:randomUUID(),projectId:project.id,status:'awaiting_review',summary:'Prepared a reviewed change.',actions:[{type:'write_file',path:'index.js',content:'export const answer = 42;\n',baseRevision:files[0]!.revision}],createdAt:now,updatedAt:now};runs.unshift(run);return json(run,202);
  }
  if(path.endsWith('/apply')){files[0]!.content='export const answer = 42;\n';files[0]!.revision++;runs[0]!.status='applied';return json(runs[0]);}
  if(path==='/api/projects/'+project.id)return json({project,files,runs});
  return json({error:{code:'FIXTURE_ROUTE',message:'Unexpected fixture request '+path}},404);
 });
 return {files,runs,approvals,publications};
}
test('coding tasks inspect proposals before applying source changes',async({page})=>{
 const state=await fixture(page);await page.goto('/');
 await expect(page.getByLabel('Edit index.js')).toHaveText('export const answer = 1;\n');
 await page.getByLabel('Coding task',{exact:true}).fill('Make the answer 42 and explain the change');
 await page.getByRole('button',{name:'Start coding task',exact:true}).click();
 await page.getByRole('button',{name:'Review proposed changes',exact:true}).click();
 await expect(page.getByText('Proposed file',{exact:true})).toBeVisible();
 expect(state.files[0]!.content).toContain('= 1');
 await page.getByRole('button',{name:'Apply all',exact:true}).click();
 await expect(page.getByLabel('Edit index.js')).toHaveText('export const answer = 42;\n');
});
test('editor saves revisions and terminal requires a separate explicit approval',async({page})=>{
 const state=await fixture(page);await page.goto('/');
 await page.getByLabel('Edit index.js').fill('console.log(5);\n');
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await expect.poll(()=>state.files[0]!.revision).toBe(2);
 await page.getByRole('tab',{name:'Terminal',exact:true}).click();
 await page.getByLabel('Command arguments').fill('--version');
 await page.getByRole('button',{name:'Review & run',exact:true}).click();
 expect(state.approvals).toHaveLength(0);
 await page.getByRole('dialog').getByRole('button',{name:'Run in sandbox',exact:true}).click();
 await expect(page.getByLabel('Command output')).toContainText('fixture command passed');
 expect(state.approvals[0]).toMatchObject({approved:true,allowNetwork:false,program:'node',args:['--version']});
});
test('linked folders show exact publication preview before disk approval',async({page})=>{
 const state=await fixture(page,true);await page.goto('/');
 await page.getByRole('button',{name:'Publish to folder',exact:true}).click();
 await expect(page.getByRole('dialog').getByText('old disk source',{exact:false})).toBeVisible();
 expect(state.publications).toHaveLength(0);
 await page.getByRole('button',{name:'Publish reviewed changes',exact:true}).click();
 await expect(page.getByText('1 file written · 0 deleted')).toBeVisible();
 expect(state.publications[0]).toEqual({approved:true,version:'a'.repeat(64)});
});
test('coding workspace fits a phone width and switches between code and task',async({page})=>{
 await page.setViewportSize({width:390,height:844});await fixture(page);await page.goto('/');
 await expect(page.getByLabel('Edit index.js')).toBeVisible();
 await page.getByRole('button',{name:'Coding partner',exact:true}).click();
 await expect(page.getByLabel('Coding task',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('file tabs and workspace views preserve unsaved drafts and quick open finds real files',async({page})=>{
 const state=await fixture(page,false,true);await page.goto('/');
 await page.getByLabel('Edit index.js').fill('const unsaved = 17;');
 await page.keyboard.press('Control+p');
 await page.getByRole('combobox',{name:'Find a project file'}).fill('greeting');await page.keyboard.press('Enter');
 await expect(page.getByLabel('Edit src/greeting.ts')).toContainText('Hello from the project');
 await page.getByRole('tab',{name:'index.js'}).click();
 await expect(page.getByLabel('Edit index.js')).toHaveText('const unsaved = 17;');
 await page.getByRole('button',{name:'Models',exact:true}).click();
 await page.getByRole('tab',{name:'Projects',exact:true}).click();
 await expect(page.getByLabel('Edit index.js')).toHaveText('const unsaved = 17;');
 await page.getByLabel('Edit index.js').press('Control+End');await page.keyboard.insertText(' // retained undo');
 await page.getByRole('tab',{name:'greeting.ts',exact:true}).click();await page.getByRole('tab',{name:'index.js'}).click();
 await page.getByLabel('Edit index.js').press('Control+z');
 await expect(page.getByLabel('Edit index.js')).toHaveText('const unsaved = 17;');
 await page.getByRole('button',{name:'Close index.js',exact:true}).click();
 await page.keyboard.press('Control+p');await page.getByRole('combobox').fill('index.js');await page.keyboard.press('Enter');
 await expect(page.getByLabel('Edit index.js')).toHaveText('const unsaved = 17;');
 expect(state.files[0]!.content).toContain('answer = 1');
});

test('project search uses source content and panels resize without replacing the editor',async({page})=>{
 await fixture(page,false,true);await page.goto('/');
 await page.getByRole('button',{name:'Search project files',exact:true}).click();
 await page.getByRole('searchbox',{name:'Search project files'}).fill('Hello from');
 await page.getByRole('button',{name:/src\/greeting.ts.*1/}).click();
 await expect(page.getByLabel('Edit src/greeting.ts')).toContainText('Hello from');
 await page.keyboard.press('Control+j');
 await expect(page.getByLabel('Command arguments')).toBeVisible();
 await expect(page.getByLabel('Edit src/greeting.ts')).toBeVisible();
 const resize=page.getByRole('separator',{name:'Resize bottom panel'});await resize.focus();await page.keyboard.press('ArrowUp');
 await expect(resize).toHaveAttribute('aria-valuenow','320');
 await page.keyboard.press('Control+j');await expect(page.getByLabel('Command arguments')).toBeHidden();
 await page.keyboard.press('Control+b');await expect(page.getByRole('complementary',{name:'Project search'})).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('IDE desktop and tablet previews remain bounded',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await fixture(page,false,true);await page.goto('/');
 await expect(page.getByLabel('Edit index.js')).toContainText('export const answer');
 await page.getByRole('tab',{name:'Terminal',exact:true}).click();
 await expect(page.getByLabel('Command arguments')).toBeVisible();
 await page.screenshot({path:'../omnichat-ide-preview.png',fullPage:true});
 await page.setViewportSize({width:1024,height:768});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect(page.getByLabel('Edit index.js')).toBeVisible();
});
