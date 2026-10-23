import {expect,it} from 'vitest';
import {splitDiff} from './split-diff';
it('aligns replacement blocks and pads unequal additions without dropping context',()=>{
  expect(splitDiff('@@ -1,2 +1,3 @@\n-a\n+b\n+c\n end\n')).toEqual([
    {left:'@@ -1,2 +1,3 @@',right:'@@ -1,2 +1,3 @@',kind:'meta'},
    {left:'a',right:'b',kind:'change'},{left:'',right:'c',kind:'change'},
    {left:'end',right:'end',kind:'context'},
  ]);
});
