// @vitest-environment jsdom
import {describe,it,expect,afterEach,vi} from 'vitest';
import {render,screen,cleanup,fireEvent,act,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {Chat,Markdown,branchMessages} from '../components/chat';
import {useUi} from '../lib/store';
import {api} from '../lib/api';
import type {Attachment,Message,User} from '@omnichat/types';
afterEach(()=>{cleanup();vi.restoreAllMocks();useUi.setState({conversationId:null,modelId:''});});
describe('safe chat presentation',()=>{
 it('renders math and highlighted code with the declared language and copy controls',()=>{const {container}=render(<Markdown content={'Equation: $x^2$\n\n```js\nconst value = 42;\n```'}/>);expect(container.querySelector('.katex')).toBeTruthy();expect(screen.getByRole('button',{name:'Copy code'})).toBeInTheDocument();expect(container.querySelector('code')).toHaveTextContent('const value = 42;');expect(container.querySelector('.code-heading')).toHaveTextContent('js');});
 it('labels unknown fenced languages and unlabeled blocks accurately',()=>{const {container}=render(<Markdown content={'```custom-lang\nhello\n```\n\n```\nplain text\n```'}/>);const headings=container.querySelectorAll('.code-heading');expect(headings[0]).toHaveTextContent('custom-lang');expect(headings[1]).toHaveTextContent('Plain text');});
 it('does not execute raw HTML or preserve javascript links',()=>{const {container}=render(<Markdown content={'<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))'}/>);expect(container.querySelector('script')).toBeNull();expect(container.querySelector('a')?.getAttribute('href')).not.toMatch(/^javascript:/);});
 it('shows selected branch without sibling messages',()=>{const base={conversationId:'c',role:'user',content:'test',modelId:null,status:'complete',createdAt:'2026-10-17T00:00:00Z'} as const;const messages:Message[]=[{...base,id:'a',parentId:null},{...base,id:'b',parentId:'a'},{...base,id:'c',parentId:'a'}];expect(branchMessages(messages,'b').map(m=>m.id)).toEqual(['a','b']);});
});

const user:User={id:'one',name:'One',email:'one@example.test'};
const attachment:Attachment={id:'attachment-one',name:'notes.txt',mimeType:'text/plain',size:5,createdAt:'2026-10-18T00:00:00Z'};
function chatFixture(){
 const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
 const base={conversationId:'first',role:'user',content:'Original question',modelId:null,status:'complete',createdAt:'2026-10-18T00:00:00Z'} as const;
 const messages:Message[]=[{...base,id:'root',parentId:null},{...base,id:'first-answer',parentId:'root',role:'assistant',content:'First answer'},{...base,id:'second-answer',parentId:'root',role:'assistant',content:'Second answer'}];
 for(const id of ['first','second'])client.setQueryData(['conversation',id],{conversation:{id,title:id},messages:id==='first'?messages:[]});
 useUi.setState({conversationId:'first',modelId:'test/model'});
 const view=(account:User=user,visible=true)=><QueryClientProvider client={client}><Chat user={account} requireAuth={()=>true} visible={visible}/></QueryClientProvider>;
 return {client,view};
}
describe('conversation tab state',()=>{
 it('retains each tab’s draft, attachments, branch selection and pending edit',async()=>{
  vi.spyOn(api,'request').mockResolvedValue(attachment);
  const {view}=chatFixture();const {container}=render(view());
  fireEvent.change(screen.getByRole('combobox',{name:'Conversation branch'}),{target:{value:'first-answer'}});
  fireEvent.change(screen.getByRole('textbox',{name:'Message'}),{target:{value:'First draft'}});
  fireEvent.change(container.querySelector('input[type="file"]')!,{target:{files:[new File(['notes'],'notes.txt')]}});
  await screen.findByRole('button',{name:'Remove notes.txt'});
  act(()=>useUi.getState().selectConversation('second'));
  expect(screen.getByRole('textbox',{name:'Message'})).toHaveValue('');
  expect(screen.queryByRole('button',{name:'Remove notes.txt'})).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox',{name:'Message'}),{target:{value:'Second draft'}});
  act(()=>useUi.getState().selectConversation('first'));
  expect(screen.getByRole('textbox',{name:'Message'})).toHaveValue('First draft');
  expect(screen.getByRole('combobox',{name:'Conversation branch'})).toHaveValue('first-answer');
  expect(screen.getByRole('button',{name:'Remove notes.txt'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Edit & branch'}));
  fireEvent.change(screen.getByRole('textbox',{name:'Message'}),{target:{value:'Edited question'}});
  act(()=>useUi.getState().selectConversation('second'));
  expect(screen.getByRole('textbox',{name:'Message'})).toHaveValue('Second draft');
  act(()=>useUi.getState().selectConversation('first'));
  expect(screen.getByRole('textbox',{name:'Message'})).toHaveValue('Edited question');
  expect(screen.getByRole('button',{name:'Cancel edit'})).toBeInTheDocument();
 });
 it('attaches an upload finishing after a tab switch to its original conversation',async()=>{
  let finish!:(value:Attachment)=>void;
  vi.spyOn(api,'request').mockImplementation(()=>new Promise(resolve=>{finish=resolve as (value:Attachment)=>void;}));
  const {view}=chatFixture();const {container}=render(view());
  fireEvent.change(container.querySelector('input[type="file"]')!,{target:{files:[new File(['notes'],'notes.txt')]}});
  act(()=>useUi.getState().selectConversation('second'));
  await act(async()=>finish(attachment));
  expect(screen.queryByRole('button',{name:'Remove notes.txt'})).not.toBeInTheDocument();
  act(()=>useUi.getState().selectConversation('first'));
  expect(screen.getByRole('button',{name:'Remove notes.txt'})).toBeInTheDocument();
 });
 it('retains a hidden workspace draft, but clears private drafts on account changes',async()=>{
  const {view}=chatFixture();const {rerender}=render(view());
  fireEvent.change(screen.getByRole('textbox',{name:'Message'}),{target:{value:'Private draft'}});
  rerender(view(user,false));rerender(view(user,true));
  expect(screen.getByRole('textbox',{name:'Message'})).toHaveValue('Private draft');
  rerender(view({...user,id:'two'}));
  await waitFor(()=>expect(screen.getByRole('textbox',{name:'Message'})).toHaveValue(''));
  rerender(view(user));
  expect(screen.getByRole('textbox',{name:'Message'})).toHaveValue('');
 });
});
