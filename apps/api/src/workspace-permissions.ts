import type {WorkspacePermissionAction,WorkspacePermissionDecision,WorkspacePermissionRule} from '@omnichat/types';

/** Directories that are never listed, searched, or auto-read. */
export const IGNORED_DIRECTORIES=new Set(['.git','.hg','.svn','node_modules','.next','.expo','.turbo','dist','build','out','coverage','release','.venv','venv','__pycache__','.cache','.idea','.vs']);
const secretNames=new Set(['id_rsa','id_dsa','id_ecdsa','id_ed25519','.npmrc','.pypirc','.netrc','.git-credentials','.htpasswd','credentials','credentials.json','secrets.json','service-account.json']);
const secretExtension=/\.(?:pem|key|p12|pfx|jks|keystore|crt|cer|der|mobileprovision|kdbx|asc|gpg)$/i;
const secretDirectories=new Set(['.ssh','.aws','.azure','.gnupg','.docker','secrets','.secrets']);

/** Common credential files. They are hidden from listings and searches and need an explicit read override. */
export function isSecretPath(path:string):boolean {
  const segments=path.toLowerCase().split('/');const name=segments.at(-1)??'';
  if(segments.some(segment=>secretDirectories.has(segment)))return true;
  if(name.startsWith('.env')&&!['.env.example','.env.sample','.env.template'].includes(name))return true;
  return secretNames.has(name)||secretExtension.test(name)||/^credentials?(?:[._-]|$)/.test(name);
}
export function isIgnoredPath(path:string):boolean {return path.split('/').some(segment=>IGNORED_DIRECTORIES.has(segment.toLowerCase()));}

/** Small glob dialect: `*`, `**`, `?`, `{a,b}`. A trailing slash means the
 * whole directory. A pattern without a slash also matches any basename. */
export function globToRegExp(pattern:string):RegExp {
  let source=pattern.trim().replace(/^\.\//,'');
  if(source.endsWith('/'))source+='**';
  let out='';
  for(let i=0;i<source.length;i++) {
    const c=source[i]!;
    if(c==='*') {
      if(source[i+1]==='*'){i++;if(source[i+1]==='/'){i++;out+='(?:.*/)?';}else out+='.*';}
      else out+='[^/]*';
    } else if(c==='?')out+='[^/]';
    else if(c==='{'){const end=source.indexOf('}',i);if(end<0){out+='\\{';continue;}out+='(?:'+source.slice(i+1,end).split(',').map(part=>part.replace(/[.+^$()|[\]\\]/g,'\\$&').replace(/\*/g,'[^/]*')).join('|')+')';i=end;}
    else out+=c.replace(/[.+^$()|[\]\\]/g,'\\$&');
  }
  return new RegExp(source.includes('/')?`^${out}$`:`^(?:.*/)?${out}$`);
}
export const matchesPattern=(pattern:string,path:string)=>globToRegExp(pattern).test(path);

/** Default: reads inside the root are allowed, edits ask, deletes and commands
 * always ask per call. Deny rules win. Secret files are denied for reads unless
 * an explicit allow-read rule names them. */
export function decide(action:WorkspacePermissionAction,target:string,rules:readonly WorkspacePermissionRule[]):WorkspacePermissionDecision {
  const matching=rules.filter(rule=>rule.action===action&&matchesPattern(rule.pattern,target));
  const deny=matching.find(rule=>rule.effect==='deny');
  if(deny)return {effect:'deny',reason:`Denied by rule "${deny.pattern}".`,ruleId:deny.id};
  const allow=matching.find(rule=>rule.effect==='allow');
  if(action!=='command'&&isSecretPath(target)) {
    if(action==='read'&&allow)return {effect:'allow',reason:`Secret read allowed by rule "${allow.pattern}".`,ruleId:allow.id};
    return {effect:'deny',reason:'This looks like a credential or secret file. Add an explicit allow-read rule to override.'};
  }
  if(action==='delete'||action==='command')return {effect:'ask',reason:action==='delete'?'Deletes need approval for each call.':'Commands need approval for each call.'};
  if(allow)return {effect:'allow',reason:`Allowed by rule "${allow.pattern}".`,ruleId:allow.id};
  return action==='read'?{effect:'allow',reason:'Reads inside the project are allowed.'}:{effect:'ask',reason:'Edits need your approval.'};
}
