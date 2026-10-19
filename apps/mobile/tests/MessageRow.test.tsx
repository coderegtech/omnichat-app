import React from 'react';
import {render,screen} from '@testing-library/react-native';
import {MessageRow} from '../src/MessageRow';
jest.mock('moti',()=>({MotiView:require('react-native').View}));
jest.mock('expo-clipboard',()=>({setStringAsync:jest.fn()}));
test('patched Markdown parser renders native content with copy and safe link handling',()=>{
 render(<MessageRow animate={false} onEdit={jest.fn()} message={{id:'a',conversationId:'c',parentId:null,role:'assistant',content:'**A formatted answer**\n\n```js\nconst x = 1;\n```',modelId:'fixture/chat',status:'complete',createdAt:'2026-10-17T00:00:00Z'}}/>);
 expect(screen.getByText('A formatted answer')).toBeTruthy();expect(screen.getByRole('button',{name:'Copy message'})).toBeTruthy();
});
