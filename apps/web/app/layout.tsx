import type {Metadata} from 'next';
import './globals.css';
import 'katex/dist/katex.min.css';
import {Providers} from '@/components/providers';
export const metadata: Metadata = {title:'OmniChat — AI coding workspace',description:'An AI coding workspace with project files, reviewed changes, and models powered by OmniRoute.'};
export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en" suppressHydrationWarning><body><Providers>{children}</Providers></body></html>;
}
