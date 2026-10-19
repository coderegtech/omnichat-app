'use client';
import {useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import type {Conversation} from '@omnichat/types';
import {api,errorMessage} from '@/lib/api';
import {useUi} from '@/lib/store';
import {ErrorNotice} from './ui';

export function ImportConversation({onImported}:{onImported:()=>void}) {
 const input=useRef<HTMLInputElement>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const cache=useQueryClient();
 const importFile=async(file?:File)=>{
  if(!file)return;setBusy(true);setError(null);
  try {
   if(file.size>1_000_000)throw new Error('Conversation exports must be smaller than 1 MB.');
   const payload=JSON.parse(await file.text());
   const conversation=await api.request<Conversation>('/conversations/import',{method:'POST',body:payload});
   await cache.invalidateQueries({queryKey:['conversations']});useUi.getState().selectConversation(conversation.id);onImported();
  }catch(error){setError(errorMessage(error));}
  finally{setBusy(false);if(input.current)input.current.value='';}
 };
 return <div className="stack"><p className="microcopy">Import an OmniChat JSON export, including its conversation branches. Attachments must be uploaded again.</p><input ref={input} hidden type="file" accept=".json,application/json" aria-label="Import conversation file" onChange={e=>void importFile(e.target.files?.[0])}/><button type="button" className="button secondary" disabled={busy} onClick={()=>input.current?.click()}>{busy?'Importing…':'Import conversation JSON'}</button><ErrorNotice message={error}/></div>;
}
