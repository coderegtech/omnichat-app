import {describe,expect,it} from 'vitest';
import {validateProjectFiles,validateProjectPath} from './coding';

describe('coding project source boundaries',()=>{
  it('accepts portable sources and explicit environment templates',()=>{
    expect(validateProjectPath('src/app.tsx')).toBe('src/app.tsx');
    expect(()=>validateProjectFiles([{path:'.env.example',content:'TOKEN='},{path:'AGENTS.md',content:'Run node --test.'}])).not.toThrow();
  });
  it.each(['../secret','src/../../secret','/etc/passwd','C:/file','src\\file','src/file:stream','src/CON.txt','src/file.','.git/config','node_modules/pkg/index.js','.env','.env.production','src/private.pem','.npmrc','src//file'])('rejects unsafe or sensitive path %s',path=>{
    expect(()=>validateProjectPath(path)).toThrow();
  });
  it('rejects case collisions, binary input and UTF-8 size overflow',()=>{
    expect(()=>validateProjectFiles([{path:'A.ts',content:''},{path:'a.ts',content:''}])).toThrow();
    expect(()=>validateProjectFiles([{path:'a.ts',content:'\0'}])).toThrow();
    expect(()=>validateProjectFiles([{path:'a.ts',content:'文'.repeat(35000)}])).toThrow();
    expect(()=>validateProjectFiles([{path:'SRC',content:''},{path:'src/index.js',content:''}])).toThrow();
  });
});
