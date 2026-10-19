'use client';
import {useState} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import type {User} from '@omnichat/types';
import {ArrowUpRight,LockKeyhole} from 'lucide-react';
import {api,errorMessage} from '@/lib/api';
import {Brand,Busy,ErrorNotice,Field,Modal} from './ui';
export function AuthDialog({open,onOpenChange}:{open:boolean;onOpenChange:(v:boolean)=>void}) {
 const queryClient=useQueryClient(); const [register,setRegister]=useState(false);const [name,setName]=useState('');const [email,setEmail]=useState('');const [password,setPassword]=useState('');
 const mutation=useMutation({mutationFn:()=>api.request<{user:User}>(`/auth/${register?'register':'login'}`,{method:'POST',body:{email,password,...(register?{name}:{})}}),onSuccess:async data=>{queryClient.setQueryData(['me'],data);await queryClient.invalidateQueries();setPassword('');onOpenChange(false);}});
 return <Modal open={open} onOpenChange={onOpenChange} title={register?'Make room for your ideas.':'Welcome back.'} description={register?'Create your private OmniChat workspace.':'Sign in to pick up where you left off.'}><div className="auth-brand"><Brand/></div><form onSubmit={e=>{e.preventDefault();mutation.mutate();}} className="stack">
 {register&&<Field label="Your name"><input autoComplete="name" value={name} onChange={e=>setName(e.target.value)} required maxLength={80} placeholder="Alex Morgan"/></Field>}
 <Field label="Email address"><input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="you@example.com"/></Field>
 <Field label="Password" hint={register?'Use at least 12 characters.':undefined}><input type="password" autoComplete={register?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} required minLength={12} maxLength={128}/></Field>
 <ErrorNotice message={mutation.error&&errorMessage(mutation.error)}/><button className="button primary full" disabled={mutation.isPending}>{mutation.isPending?<Busy label="Connecting"/>:<>{register?'Create account':'Sign in'}<ArrowUpRight size={17}/></>}</button>
 </form><p className="auth-switch">{register?'Already have an account?':'New to OmniChat?'} <button className="text-button accent" onClick={()=>{setRegister(!register);mutation.reset();}}>{register?'Sign in':'Create an account'}</button></p><div className="privacy-note"><LockKeyhole size={13}/>Your gateway credentials stay on the server.</div></Modal>;
}
