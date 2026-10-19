import {afterAll,beforeEach,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,realpath,rm,symlink,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import type {Model,WorkspaceEvent} from '@omnichat/types';
import {WorkspaceSession,type ChatFn,type ChatMessage} from '../src/workspace-agent.js';
import {decide,globToRegExp} from '../src/workspace-permissions.js';
import {INSTRUCTIONS_MAX_CHARS,SandboxError,WorkspaceSandbox} from '../src/workspace-sandbox.js';
import {unifiedDiff} from '../src/workspace-diff.js';

const work=resolve('work','workspace-tests');
const model:Model={id:'fixture/model',name:'Fixture',provider:'fixture',capabilities:{chat:true},availability:'available',contextWindow:64000} as Model;
const SECRET='sk-fixture-secret-value-123';
let root:string;let outside:string;

/** A scripted model: each call returns the next JSON response and records the prompt it saw. */
function scripted(...responses:unknown[]) {
  const seen:ChatMessage[][]=[];let index=0;
  const chat:ChatFn=async function*(messages){seen.push(messages.map(item=>({...item})));const next=responses[index++]??{message:'Finished.',actions:[],done:true};yield {text:typeof next==='string'?next:JSON.stringify(next)};};
  return {chat,seen};
}
const run=async(session:WorkspaceSession,chat:ChatFn,prompt='Do the task')=>{const events:WorkspaceEvent[]=[];const reason=await session.runTurn({prompt,model,chat,signal:new AbortController().signal,emit:event=>events.push(event)});return {reason,events};};
const fails=async(work:Promise<unknown>,code:string)=>{await expect(work).rejects.toBeInstanceOf(SandboxError);await work.catch(error=>expect((error as SandboxError).code).toBe(code));};

beforeEach(async()=>{
  const base=join(work,randomUUID());root=join(base,'project');outside=join(base,'outside');
  await mkdir(join(root,'src'),{recursive:true});await mkdir(outside,{recursive:true});
  root=await realpath(root);outside=await realpath(outside);
  await writeFile(join(root,'src','app.ts'),'export const a = 1;\nexport const b = 1;\nexport const c = 2;\n');
  await writeFile(join(root,'.env'),`API_KEY=${SECRET}\n`);
  await writeFile(join(outside,'private.txt'),'outside the root');
});
afterAll(async()=>{await rm(work,{recursive:true,force:true});});

describe('workspace sandbox paths',()=>{
  it('blocks traversal, absolute paths and links that escape the root',async()=>{
    const sandbox=await WorkspaceSandbox.open(root);
    await fails(sandbox.resolve('../outside/private.txt'),'PATH_ESCAPE');
    await fails(sandbox.resolve('src/../../outside/private.txt'),'PATH_ESCAPE');
    await fails(sandbox.resolve(join(outside,'private.txt').replace(/\\/g,'/')),'PATH_ESCAPE');
    await fails(sandbox.resolve('/etc/passwd'),'PATH_ESCAPE');
    // A junction needs no admin rights on Windows and is a directory symlink elsewhere.
    await symlink(outside,join(root,'escape'),'junction');
    await fails(sandbox.readFile('escape/private.txt'),'PATH_ESCAPE');
    await fails(sandbox.planWrite('escape/new.txt','x'),'PATH_ESCAPE');
    expect((await sandbox.listDir('',1)).entries.map(entry=>entry.path)).not.toContain('escape');
    expect((await sandbox.readFile('src/app.ts')).content).toContain('export const a');
  });
});

describe('edit_file',()=>{
  it('fails when the snippet is missing or not unique and leaves the file unchanged',async()=>{
    const sandbox=await WorkspaceSandbox.open(root);
    await fails(sandbox.planEdit('src/app.ts','= 1;','= 3;'),'EDIT_NOT_UNIQUE');
    await fails(sandbox.planEdit('src/app.ts','export const z','x'),'EDIT_NOT_FOUND');
    const planned=await sandbox.planEdit('src/app.ts','export const b = 1;','export const b = 5;');
    expect(planned.diff).toContain('-export const b = 1;');expect(planned.diff).toContain('+export const b = 5;');
    expect(await readFile(join(root,'src','app.ts'),'utf8')).toContain('export const b = 1;');
  });
  it('reports a non-unique match to the model as a tool error and stops the turn',async()=>{
    const session=await WorkspaceSession.bind({userId:'u',root});
    const {chat,seen}=scripted({actions:[{tool:'read_file',path:'src/app.ts'}]},{actions:[{tool:'edit_file',path:'src/app.ts',oldText:'= 1;',newText:'= 3;'}]},{message:'should not be called',actions:[]});
    const {reason,events}=await run(session,chat);
    expect(reason).toBe('tool_error');expect(seen).toHaveLength(2);
    expect(events.some(event=>event.type==='tool_result'&&!event.ok&&event.summary.includes('matches 2 places'))).toBe(true);
    expect(session.history.at(-1)!.content).toContain('EDIT_NOT_UNIQUE');
  });
});

describe('project instructions',()=>{
  it('loads CLAUDE.md once at bind time and truncates it',async()=>{
    const long='# Rules\n'+'Always run the tests. '.repeat(1000);
    await writeFile(join(root,'CLAUDE.md'),long);await writeFile(join(root,'AGENTS.md'),'agents file should lose to CLAUDE.md');
    const session=await WorkspaceSession.bind({userId:'u',root});
    expect(session.instructions?.path).toBe('CLAUDE.md');expect(session.instructions?.truncated).toBe(true);
    expect(session.instructions!.content.length).toBe(INSTRUCTIONS_MAX_CHARS);
    await writeFile(join(root,'CLAUDE.md'),'CHANGED AFTER BIND');
    const {chat,seen}=scripted({message:'one',actions:[],done:true},{message:'two',actions:[],done:true});
    await run(session,chat,'first');await run(session,chat,'second');
    for(const messages of seen) {
      const system=messages[0]!.content;
      expect(system).toContain(session.instructions!.content);expect(system).not.toContain('CHANGED AFTER BIND');
      expect(system.split('<project-instructions>').length-1).toBe(1);
      expect(messages.slice(1).some(item=>item.content.includes('Always run the tests.'))).toBe(false);
    }
  });
});

describe('secret files',()=>{
  it('does not auto-read .env and keeps it out of listings, search and reads',async()=>{
    const session=await WorkspaceSession.bind({userId:'u',root});
    expect(session.index).not.toContain('.env');expect(session.instructions).toBeNull();
    const {chat,seen}=scripted({actions:[{tool:'list_dir',path:'',depth:2},{tool:'search_text',query:'sk-fixture'}]},{actions:[{tool:'read_file',path:'.env'}]});
    const {reason,events}=await run(session,chat);
    expect(reason).toBe('tool_error');
    expect(events.some(event=>event.type==='tool_result'&&!event.ok&&event.summary.includes('secret'))).toBe(true);
    const sent=JSON.stringify(seen)+JSON.stringify(session.history);
    expect(sent).not.toContain(SECRET);expect(sent).not.toContain('"entries":[".env');
    await expect(session.addContext('.env')).rejects.toMatchObject({code:'SECRET_FILE'});
    session.rules=[{id:'deny-env',effect:'deny',action:'read',pattern:'.env'}];
    await expect(session.addContext('.env',true)).rejects.toMatchObject({code:'PERMISSION_DENIED'});
  });
});

describe('approval',()=>{
  const editScript=()=>scripted({actions:[{tool:'read_file',path:'src/app.ts'}]},{message:'Changing c.',actions:[{tool:'edit_file',path:'src/app.ts',oldText:'export const c = 2;',newText:'export const c = 3;'}]});
  it('does not write an edit until it is approved',async()=>{
    const session=await WorkspaceSession.bind({userId:'u',root});const {chat}=editScript();
    const {reason,events}=await run(session,chat);
    expect(reason).toBe('awaiting_approval');
    const pending=events.find(event=>event.type==='pending');
    expect(pending?.type==='pending'?pending.change.diff:'').toContain('+export const c = 3;');
    expect(await readFile(join(root,'src','app.ts'),'utf8')).toContain('export const c = 2;');
    await expect(run(session,scripted().chat,'next')).rejects.toMatchObject({code:'PENDING_CHANGES'});
    const id=pending?.type==='pending'?pending.change.id:'';
    expect((await session.decideChange(id,true)).status).toBe('applied');
    expect(await readFile(join(root,'src','app.ts'),'utf8')).toContain('export const c = 3;');
  });
  it('leaves the file unchanged when rejected, and refuses a stale approval',async()=>{
    const session=await WorkspaceSession.bind({userId:'u',root});
    await run(session,editScript().chat);
    const [first]=session.view().pending;
    expect((await session.decideChange(first!.id,false)).status).toBe('rejected');
    expect(await readFile(join(root,'src','app.ts'),'utf8')).toContain('export const c = 2;');
    await run(session,editScript().chat);
    await writeFile(join(root,'src','app.ts'),'edited elsewhere\n');
    const [second]=session.view().pending;
    const decided=await session.decideChange(second!.id,true);
    expect(decided.status).toBe('failed');expect(decided.error).toContain('changed on disk');
    expect(await readFile(join(root,'src','app.ts'),'utf8')).toBe('edited elsewhere\n');
  });
  it('applies edits immediately only where an allow rule matches',async()=>{
    const session=await WorkspaceSession.bind({userId:'u',root});session.rules=[{id:'src',effect:'allow',action:'edit',pattern:'src/'}];
    const {reason}=await run(session,editScript().chat);
    expect(reason).toBe('complete');
    expect(await readFile(join(root,'src','app.ts'),'utf8')).toContain('export const c = 3;');
  });
  it('requires a read before editing',async()=>{
    const session=await WorkspaceSession.bind({userId:'u',root});
    const {reason,events}=await run(session,scripted({actions:[{tool:'edit_file',path:'src/app.ts',oldText:'export const c = 2;',newText:'x'}]}).chat);
    expect(reason).toBe('tool_error');expect(events.some(event=>event.type==='tool_result'&&event.summary.includes('Read src/app.ts'))).toBe(true);
  });
});

describe('permissions and diff helpers',()=>{
  it('applies defaults, deny-wins rules and globs',()=>{
    expect(decide('read','src/a.ts',[]).effect).toBe('allow');
    expect(decide('edit','src/a.ts',[]).effect).toBe('ask');
    expect(decide('delete','src/a.ts',[{id:'1',effect:'allow',action:'delete',pattern:'**'}]).effect).toBe('ask');
    expect(decide('edit','src/a.ts',[{id:'1',effect:'allow',action:'edit',pattern:'src/'}]).effect).toBe('allow');
    expect(decide('edit','lib/a.ts',[{id:'1',effect:'allow',action:'edit',pattern:'src/'}]).effect).toBe('ask');
    expect(decide('read','config/.env.local',[]).effect).toBe('deny');
    expect(decide('read','.env.example',[]).effect).toBe('allow');
    expect(globToRegExp('*.{ts,tsx}').test('src/deep/a.tsx')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/deep/a.ts')).toBe(false);
  });
  it('produces a unified diff',()=>{
    expect(unifiedDiff('a.txt','one\ntwo\nthree\n','one\n2\nthree\n')).toBe('--- a/a.txt\n+++ b/a.txt\n@@ -1,3 +1,3 @@\n one\n-two\n+2\n three\n');
    expect(unifiedDiff('n.txt',null,'x\n')).toBe('--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,1 @@\n+x\n');
  });
});
