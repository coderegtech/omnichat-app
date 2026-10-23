import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {WorkspaceSessionView} from '@omnichat/types';

async function fixture(page:Page,restore=true){
  const id=randomUUID();let content='export const value = 1;\n';let writes=0;let gitWrites=0;
  const session:WorkspaceSessionView={id,name:'fixture-project',root:'C:/Projects/fixture-project',title:'Explore the project',pinned:false,modelId:'fixture/chat',mode:'agent',memory:'',instructions:null,index:['a.ts'],rules:[],pending:[],transcript:[{type:'user',text:'Explain this project'},{type:'assistant',text:'The project contains a small TypeScript module.'}],running:false,commandsEnabled:true,createdAt:new Date().toISOString()};
  const sessions=[session];
  if(restore)await page.addInitScript(id=>sessionStorage.setItem('omnichat.workspace-session',id),id);
  await page.route('**/api/**',async route=>{
    const request=route.request();const url=new URL(request.url());const path=url.pathname;const method=request.method();
    const json=(value:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
    if(path==='/api/auth/me')return json({user:{id:'fixture-user',name:'Developer',email:'developer@example.test'}});
    if(path==='/api/settings')return json({theme:'dark',defaultModel:'fixture/chat',favoriteModels:[],systemPrompt:'',streaming:true,animations:false});
    if(path==='/api/models'||path==='/api/status')return json({models:[{id:'fixture/chat',name:'Fixture Chat',provider:'Fixture',capabilities:{chat:true,streaming:true},availability:'available'}],connection:{status:'connected'},endpoints:[]});
    if(path==='/api/workspace/roots')return json({items:[],reason:'Choose authorized project roots in the local companion configuration.'});
    if(path==='/api/workspace/sessions'){
      if(method==='POST'){const next={...session,id:randomUUID(),title:'New chat',transcript:[]};sessions.push(next);return json(next,201);}
      return json({items:sessions.map(row=>({...row,updatedAt:row.createdAt}))});
    }
    const current=sessions.find(row=>path.includes(row.id));
    if(current){
      if(path.endsWith('/tree'))return json({entries:[{path:'a.ts',name:'a.ts',type:'file',size:24}],limited:false});
      if(path.endsWith('/file')){if(method==='POST'){const body=request.postDataJSON();if(body.before!==content)return json({error:{code:'CONFLICT',message:'File changed'}},409);content=body.after;writes++;return json({ok:true});}return json({content,truncated:false});}
      if(path.endsWith('/git')){if(method==='POST'){gitWrites++;return json({output:'Done'});}return json({output:'## main\n M a.ts\n'});}
      if(path.endsWith('/terminals'))return json({shells:['powershell','cmd'],items:[]});
      if(method==='PATCH')Object.assign(current,request.postDataJSON());
      return json(current);
    }
    return json({items:[]});
  });
  return {session,get writes(){return writes;},get gitWrites(){return gitWrites;}};
}

test('Projects opens the direct workspace by default and keeps saved imports accessible',async({page})=>{
  await fixture(page,false);await page.goto('/');
  await expect(page.getByRole('tab',{name:'Projects',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('button',{name:'Add Local Project',exact:true})).toBeVisible();
  await expect(page.getByLabel('Search projects and chats')).toBeVisible();
  await expect(page.getByRole('heading',{name:'Work in your existing project.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Saved projects',exact:true})).toBeVisible();
  await expect(page.getByText('Import a source folder',{exact:true})).toBeHidden();
  await page.screenshot({path:'test-results/local-workspace-home.png',fullPage:true});
});

test('local workspace restores chats, reviews saves and enforces read-only editing in its UI',async({page})=>{
  const state=await fixture(page);await page.setViewportSize({width:1440,height:1000});await page.goto('/');
  await expect(page.getByRole('tab',{name:'Projects',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('button',{name:'Explore the project',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'a.ts',exact:true}).click();
  const editor=page.getByRole('textbox',{name:'Edit a.ts'});
  await expect(editor).toBeVisible();await editor.fill('export const value = 2;');
  await page.getByRole('button',{name:'Review & save'}).click();expect(state.writes).toBe(0);
  await page.getByRole('button',{name:'Accept & save'}).click();await expect.poll(()=>state.writes).toBe(1);
  await expect(editor).toHaveText('export const value = 2;');
  await page.getByLabel('Chat mode').selectOption('plan');await expect.poll(()=>state.session.mode).toBe('plan');
  await expect(editor).toHaveAttribute('aria-readonly','true');
  const readOnlyText=await editor.innerText();await editor.press('x');await expect(editor).toHaveText(readOnlyText);
  await page.getByLabel('Chat mode').selectOption('agent');
  await page.getByRole('tab',{name:'Git',exact:true}).click();await page.getByLabel('Git action',{exact:true}).selectOption('push');
  await page.getByRole('button',{name:'Review Git action'}).click();expect(state.gitWrites).toBe(0);
  await page.getByRole('button',{name:'Approve push'}).click();await expect.poll(()=>state.gitWrites).toBe(1);
  await page.screenshot({path:'test-results/local-workspace-desktop.png',fullPage:true});
  await page.reload();await expect(page.getByRole('tab',{name:'Projects',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.getByText('The project contains a small TypeScript module.')).toBeVisible();
});

test('project search, new chats and narrow layouts remain usable',async({page})=>{
  await fixture(page);await page.goto('/');await expect(page.getByRole('tab',{name:'Projects',exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByLabel('Search projects and chats').fill('not found');await expect(page.getByRole('button',{name:'Explore the project',exact:true})).toHaveCount(0);
  await page.getByLabel('Search projects and chats').fill('fixture-project');await page.getByRole('button',{name:'New chat in fixture-project'}).click();
  await expect(page.getByRole('button',{name:'New chat',exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Tools',exact:true}).click();
  await expect(page.getByLabel('Message the local agent')).toBeVisible();
  await page.screenshot({path:'test-results/local-workspace-mobile.png',fullPage:true});
});
