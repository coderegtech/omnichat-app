import {describe,it,expect} from 'vitest';
import {messageAncestry,trimContext} from './conversation';
describe('conversation branches and context',()=>{
  it('never includes a sibling branch',()=>expect(messageAncestry([{id:'a',parentId:null},{id:'b',parentId:'a'},{id:'c',parentId:'a'}],'c').map(m=>m.id)).toEqual(['a','c']));
  it('rejects cycles and unknown parents',()=>{expect(()=>messageAncestry([{id:'a',parentId:'a'}],'a')).toThrow('cycle');expect(()=>messageAncestry([],'other-user')).toThrow('does not exist');});
  it('retains system and latest request, omits orphaned assistants',()=>{const source=[{role:'system',content:'sys'},{role:'user',content:'older'},{role:'assistant',content:'reply'},{role:'user',content:'new'}];expect(trimContext(source,11)).toEqual({messages:[source[0],source[3]],omitted:2});});
  it('rejects latest messages exceeding safe budget instead of silently truncating',()=>expect(()=>trimContext([{role:'user',content:'too long'}],3)).toThrow('latest message'));
});
