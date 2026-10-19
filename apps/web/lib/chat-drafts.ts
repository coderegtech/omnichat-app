'use client';
import {useCallback,useEffect,useRef,useState,type SetStateAction} from 'react';
import type {Attachment} from '@omnichat/types';

interface ChatDraft {
 draft:string;
 attachments:Attachment[];
 leafId:string|null;
 branchParent:string|null|undefined;
 searchOn:boolean;
 error:string|null;
}
const emptyDraft=():ChatDraft=>({draft:'',attachments:[],leafId:null,branchParent:undefined,searchOn:false,error:null});
type Patch=Partial<ChatDraft>|((current:ChatDraft)=>Partial<ChatDraft>);

// Keep private, unsent content only in memory and only for the current account.
// Explicit IDs ensure an upload or stream finishing after a tab switch updates its original tab.
export function useChatDrafts(ownerId:string|undefined,conversationId:string|null) {
 const owner=useRef(ownerId);owner.current=ownerId;
 const [session,setSession]=useState<{ownerId:string|undefined;values:Record<string,ChatDraft>}>({ownerId,values:{}});
 useEffect(()=>{setSession(current=>current.ownerId===ownerId?current:{ownerId,values:{}});},[ownerId]);
 const update=useCallback((id:string|null,patch:Patch)=>{
  if(owner.current!==ownerId)return;
  setSession(current=>{
   if(owner.current!==ownerId)return current;
   const values=current.ownerId===ownerId?current.values:{};
   const key=id??'new';const previous=values[key]??emptyDraft();
   return {ownerId,values:{...values,[key]:{...previous,...(typeof patch==='function'?patch(previous):patch)}}};
  });
 },[ownerId]);
 const value=(session.ownerId===ownerId?session.values[conversationId??'new']:undefined)??emptyDraft();
 const setField=useCallback(<K extends keyof ChatDraft>(field:K,next:SetStateAction<ChatDraft[K]>)=>{
  update(conversationId,current=>({[field]:typeof next==='function'?(next as (value:ChatDraft[K])=>ChatDraft[K])(current[field]):next}));
 },[conversationId,update]);
 return {value,update,setField};
}
