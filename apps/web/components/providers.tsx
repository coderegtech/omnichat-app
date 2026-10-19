'use client';
import {useState} from 'react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MotionConfig} from 'motion/react';
export function Providers({children}:{children:React.ReactNode}) {
 const [client] = useState(()=>new QueryClient({defaultOptions:{queries:{staleTime:30_000,retry:1,refetchOnWindowFocus:false},mutations:{retry:false}}}));
 return <QueryClientProvider client={client}><MotionConfig reducedMotion="user">{children}</MotionConfig></QueryClientProvider>;
}
