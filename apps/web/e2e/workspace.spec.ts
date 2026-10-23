import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {Conversation,Message,ModelRegistry,UserSettings} from '@omnichat/types';

// Explicitly mocked integration fixtures. No provider calls or gateway keys.
async function mockWorkspace(page:Page,signedIn=true) {
 const user={id:randomUUID(),name:'QA User',email:'qa@example.test'};
 let settings:UserSettings={theme:'dark',defaultModel:'fixture/chat',favoriteModels:[],systemPrompt:'',streaming:true,animations:false};
 const registry:ModelRegistry={connection:{status:'connected',checkedAt:new Date().toISOString()},models:[
  {id:'fixture/chat',name:'Fixture Chat',provider:'Test',capabilities:{chat:true,streaming:true},availability:'unknown',metadataSource:'gateway'},
  {id:'fixture/other',name:'Other Chat',provider:'Other',capabilities:{chat:true},availability:'unknown',metadataSource:'gateway'},
  {id:'fixture/image',name:'Image Only',provider:'Test',capabilities:{images:true},availability:'unknown',metadataSource:'gateway'}
 ],endpoints:[{id:'chat',label:'Chat',path:'/v1/chat/completions',available:true},{id:'video',label:'Video',path:'/v1/videos/generations',available:false,reason:'No validated video adapter.'},{id:'search',label:'Search',path:'/v1/search',available:false,reason:'No search provider configured.'}]};
 const conversations:Conversation[]=[];const messages:Message[]=[];const sentModels:string[]=[];
 await page.route('**/api/**',async route=>{
  const req=route.request();const path=new URL(req.url()).pathname;const method=req.method();
  const json=(body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(path==='/api/auth/me')return signedIn?json({user}):json({error:{code:'UNAUTHENTICATED',message:'Sign in'}},401);
  if(path==='/api/auth/login'||path==='/api/auth/register'){signedIn=true;return json({user});}
  if(path==='/api/auth/logout'){signedIn=false;return json({ok:true});}
  if(path==='/api/models'||path==='/api/status'||path==='/api/models/refresh')return json(registry);
  if(path==='/api/settings'){if(method==='PATCH')settings={...settings,...req.postDataJSON()};return json(settings);}
  if(['/api/projects','/api/folders','/api/generations','/api/attachments'].includes(path))return json({items:[]});
  if(['/api/workspace/sessions','/api/workspace/roots'].includes(path))return json({items:[]});
  if(path==='/api/conversations'){
   if(method==='POST'){const now=new Date().toISOString();const body=req.postDataJSON();const c:Conversation={id:randomUUID(),title:body.title||'New conversation',modelId:body.modelId||null,pinned:false,folderId:null,createdAt:now,updatedAt:now};conversations.push(c);return json(c,201);}
   return json({items:conversations});
  }
  const id=path.split('/')[3];const conversation=conversations.find(c=>c.id===id);
  if(path.endsWith('/messages')){
   const body=req.postDataJSON();sentModels.push(body.modelId);const now=new Date().toISOString();
   const parent=body.regenerate?messages.find(m=>m.id===body.parentId)!:{id:randomUUID(),parentId:body.parentId??null,conversationId:id,content:body.content,modelId:null,role:'user',status:'complete',createdAt:now} as Message;
   if(!body.regenerate)messages.push(parent);
   const assistant:Message={id:randomUUID(),parentId:parent.id,conversationId:id,role:'assistant',content:'A deterministic streamed answer.',modelId:body.modelId,status:'complete',createdAt:now};messages.push(assistant);
   const events=[{type:'meta',conversationId:id,userMessageId:parent.id,assistantMessageId:assistant.id},{type:'delta',text:'A deterministic '},{type:'delta',text:'streamed answer.'},{type:'done',message:assistant}];
   return route.fulfill({contentType:'text/event-stream',body:events.map(e=>`data: ${JSON.stringify(e)}\n\n`).join('')});
  }
  if(path.endsWith('/cancel'))return json({ok:true});
  if(path.endsWith('/export'))return json({conversation,messages});
  if(conversation){if(method==='PATCH')Object.assign(conversation,req.postDataJSON());return json(method==='GET'?{conversation,messages:messages.filter(m=>m.conversationId===id)}:conversation);}
  return json({error:{code:'NOT_FOUND',message:'Fixture route unavailable'}},404);
 });
 return {sentModels,messages};
}

test('signed-out experience opens working authentication and authenticates',async({page})=>{
 await mockWorkspace(page,false);await page.goto('/');await page.getByRole('button',{name:'Sign in',exact:true}).last().click();
 const dialog=page.getByRole('dialog');await dialog.getByLabel('Email address').fill('qa@example.test');await dialog.getByLabel('Password').fill('fixture password 12345');await dialog.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(dialog).toBeHidden();await expect(page.getByText('Gateway connected')).toBeVisible();
});
test('chat streams, persists in history, regenerates branches and switches providers',async({page})=>{
 const fixture=await mockWorkspace(page);await page.goto('/');await page.getByRole('button',{name:'Chat',exact:true}).click();await expect(page.getByRole('button',{name:'Fixture Chat'})).toBeVisible();
 await page.getByLabel('Message',{exact:true}).fill('Explain streams');await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect(page.getByText('A deterministic streamed answer.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Regenerate',exact:true}).click();await expect(page.getByLabel('Conversation branch')).toBeVisible();
 await page.getByRole('button',{name:'Fixture Chat'}).click();await expect(page.getByRole('dialog').getByText('Image Only',{exact:true})).toHaveCount(0);
 await page.getByRole('dialog').getByRole('button',{name:/Other Chat Other/}).click();
 await page.getByLabel('Message',{exact:true}).fill('Use the second provider');await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect.poll(()=>fixture.sentModels.at(-1)).toBe('fixture/other');await expect(page.getByRole('button',{name:'Stop generation'})).toHaveCount(0);
});
test('unsupported media is clearly disabled and never submits generation',async({page})=>{
 await mockWorkspace(page);await page.goto('/');await page.getByRole('button',{name:'Video studio',exact:true}).click();
 await expect(page.getByText('This capability is not available yet')).toBeVisible();await expect(page.getByRole('button',{name:'Generate',exact:true})).toBeDisabled();
});
test('light preference is applied and saved to the API',async({page})=>{
 await mockWorkspace(page);await page.goto('/');await page.getByRole('button',{name:'Open preferences',exact:true}).click();await page.getByRole('button',{name:'Light',exact:true}).click();await page.getByRole('button',{name:'Save preferences',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-theme','light');await expect(page.getByRole('button',{name:'Import conversation JSON'})).toBeVisible();
});
test('mobile web drawer and composer fit a narrow viewport',async({page})=>{
 await page.setViewportSize({width:390,height:844});await mockWorkspace(page);await page.goto('/');
 await page.getByRole('button',{name:'Open navigation',exact:true}).click();await expect(page.getByRole('button',{name:'Models',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Models',exact:true}).click();await expect(page.getByRole('heading',{name:'Find your thinking partner.'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('command palette navigates with the keyboard and retained chat keeps its draft',async({page})=>{
 await mockWorkspace(page);await page.goto('/');await page.getByRole('button',{name:'Chat',exact:true}).click();
 await page.getByLabel('Message',{exact:true}).fill('Keep this unsent draft');
 await page.keyboard.press('Control+Shift+p');
 await page.getByRole('combobox',{name:'Search commands'}).fill('Browse models');await page.keyboard.press('Enter');
 await expect(page.getByRole('heading',{name:'Find your thinking partner.'})).toBeVisible();
 await page.getByRole('tab',{name:'Chat',exact:true}).click();
 await expect(page.getByLabel('Message',{exact:true})).toHaveValue('Keep this unsent draft');
 await page.keyboard.press('Control+b');await expect(page.getByRole('complementary',{name:'Conversation sidebar'})).toBeHidden();
 await page.keyboard.press('Control+b');await expect(page.getByRole('complementary',{name:'Conversation sidebar'})).toBeVisible();
 await page.keyboard.press('Control+Shift+p');await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toBeHidden();
});

test('signing out from Chat clears private drafts and leaves a usable workspace',async({page})=>{
 await mockWorkspace(page);await page.goto('/');await page.getByRole('button',{name:'Chat',exact:true}).click();
 await page.getByLabel('Message',{exact:true}).fill('Private draft');
 await page.getByRole('button',{name:'Account options'}).click();await page.getByRole('menuitem',{name:'Sign out'}).click();
 await expect(page.getByLabel('Message',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Message',{exact:true})).toHaveValue('');
 await expect(page.getByRole('tab',{name:'Chat',exact:true})).toHaveAttribute('aria-selected','true');
});
