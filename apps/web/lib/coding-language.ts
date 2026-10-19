export function fileLanguage(path:string|null) {
 const labels:Record<string,string>={js:'JavaScript',jsx:'JavaScript JSX',mjs:'JavaScript',cjs:'JavaScript',ts:'TypeScript',tsx:'TypeScript JSX',json:'JSON',css:'CSS',html:'HTML',htm:'HTML',md:'Markdown',mdx:'Markdown',py:'Python'};
 return labels[path?.split('.').at(-1)?.toLowerCase()||'']||'Plain text';
}
