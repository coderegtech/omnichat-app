export type ImportedSource={path:string;content:string};
export type ImportReport={name:string;files:ImportedSource[];excluded:{path:string;reason:string}[];bytes:number};
const blockedDirectories=new Set(['.git','node_modules','.next','dist','build','coverage','.expo','.turbo','.cache','__pycache__','.venv','venv','.ssh','.aws','.kube','.npm']);
const sourceExtensions=new Set(['txt','md','markdown','mdx','js','mjs','cjs','ts','tsx','jsx','json','jsonc','html','htm','css','scss','sass','less','yaml','yml','toml','ini','cfg','conf','xml','svg','sh','bash','zsh','ps1','bat','cmd','py','go','rs','java','kt','kts','swift','c','cc','cpp','h','hh','hpp','cs','rb','php','sql','prisma','graphql','gql','vue','svelte','astro','ex','exs','erl','hrl','clj','cljs','edn','r','rmd','dart','lua','pl','pm','proto','tf','hcl','properties','gradle']);
const sourceNames=new Set(['dockerfile','containerfile','makefile','cmakelists.txt','license','readme','procfile','.gitignore','.gitattributes','.dockerignore','.editorconfig','.prettierrc','.eslintignore']);
export function sourcePathProblem(path:string):string|null {
 if(!path||path.startsWith('/')||path.includes('\\')||path.split('/').some(part=>!part||part==='.'||part==='..')||/^[a-z]:/i.test(path))return 'Invalid relative path';
 if(path.length>240||/[\x00-\x1f\x7f<>:"|?*]/.test(path)||path.split('/').some(part=>/[. ]$/.test(part)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)))return 'Unsafe source path';
 const parts=path.toLowerCase().split('/');const name=parts.at(-1)!;
 if(parts.some(part=>blockedDirectories.has(part)))return 'Dependency, build, or private directory';
 if((name.startsWith('.env')&&!['.env.example','.env.template'].includes(name))||/^id_(rsa|dsa|ecdsa|ed25519)/.test(name)||/\.(pem|key|p12|pfx|keystore|jks)$/.test(name)||['.npmrc','.pypirc','.netrc','.yarnrc.yml','credentials','credentials.json','secrets.json','secrets.yaml','secrets.yml'].includes(name))return 'Potential credentials or secrets';
 if(!['.env.example','.env.template'].includes(name)&&!sourceNames.has(name)&&!sourceExtensions.has(name.split('.').at(-1)||''))return 'Not a supported text source file';
 return null;
}
export function sourceContentProblem(content:string):string|null {
 if(content.includes('\0'))return 'Binary content';
 if(/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(content))return 'Private key content';
 return null;
}
export async function readSourceDirectory(input:FileList|File[]):Promise<ImportReport>{
 const all=Array.from(input);const root=all[0]?.webkitRelativePath?.split('/')[0]||'Imported project';const report:ImportReport={name:root,files:[],excluded:[],bytes:0};
 for(const file of all){const relative=file.webkitRelativePath;const path=relative?relative.split('/').slice(1).join('/'):file.name;const problem=sourcePathProblem(path);if(problem){report.excluded.push({path,reason:problem});continue;}if(file.size>100*1024){report.excluded.push({path,reason:'File exceeds 100 KB'});continue;}let content:string;try{content=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());}catch{report.excluded.push({path,reason:'Not UTF-8 text'});continue;}const contentProblem=sourceContentProblem(content);if(contentProblem){report.excluded.push({path,reason:contentProblem});continue;}const bytes=new TextEncoder().encode(content).byteLength;if(report.files.length>=200||report.bytes+bytes>2*1024*1024)throw new Error('This project exceeds 200 text files or 2 MB. Choose a smaller source folder.');report.files.push({path,content});report.bytes+=bytes;}
 if(!report.files.length)throw new Error('No supported source files were found. Choose a folder containing text or code files.');return report;
}
export function readSourceBundle(text:string):ImportReport {
 let data:unknown;try{data=JSON.parse(text);}catch{throw new Error('This file is not valid JSON. Choose an OmniChat project export.');}
 const bundle=data as {project?:{name?:unknown};files?:unknown};if(!bundle||!Array.isArray(bundle.files))throw new Error('The export must contain a files array.');if(bundle.files.length>200)throw new Error('Project imports are limited to 200 files.');
 const report:ImportReport={name:typeof bundle.project?.name==='string'?bundle.project.name:'Imported project',files:[],excluded:[],bytes:0};const seen=new Set<string>();
 for(const file of bundle.files){if(!file||typeof file.path!=='string'||typeof file.content!=='string')throw new Error('Every source file needs a path and text content.');const problem=sourcePathProblem(file.path)||sourceContentProblem(file.content);if(problem){report.excluded.push({path:file.path,reason:problem});continue;}if(seen.has(file.path))throw new Error(`Duplicate file path: ${file.path}`);seen.add(file.path);if(new TextEncoder().encode(file.content).byteLength>100*1024)throw new Error('Source files must be 100 KB or smaller.');report.bytes+=new TextEncoder().encode(file.content).byteLength;if(report.bytes>2*1024*1024)throw new Error('Project imports are limited to 2 MB of source text.');report.files.push({path:file.path,content:file.content});}
 if(!report.files.length)throw new Error('No supported source files were found in this export.');return report;
}
export function parseCommandArguments(value:string):string[]{const result:string[]=[];let token='';let quote:string|null=null;let started=false;for(let i=0;i<value.length;i++){const char=value[i]!;if(quote){if(char===quote)quote=null;else if(char==='\\'&&quote==='"'&&[quote,'\\'].includes(value[i+1]||'')){token+=value[++i];}else token+=char;started=true;}else if(char==='"'||char==="'"){quote=char;started=true;}else if(/\s/.test(char)){if(started){result.push(token);token='';started=false;}}else{token+=char;started=true;}}if(quote)throw new Error('Close the quotation mark in the arguments field.');if(started)result.push(token);return result;}
