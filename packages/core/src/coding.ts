export const CODING_MAX_FILES = 200;
export const CODING_MAX_FILE_BYTES = 100 * 1024;
export const CODING_MAX_PROJECT_BYTES = 2 * 1024 * 1024;

const deniedDirectories = new Set(['.git', '.hg', '.svn', 'node_modules', '.ssh', '.aws', '.azure', '.gnupg', '.codex', 'secrets', '.secrets']);
const secretExtension = /\.(?:pem|key|p12|pfx|jks|keystore|mobileprovision)$/i;
const deviceName = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i;

/** Portable source paths only. Never normalize a traversal into an accepted path. */
export function validateProjectPath(value: string): string {
  if (!value || value.length > 240 || /[\\\x00-\x1f\x7f<>:"|?*]/.test(value) || value.startsWith('/')) {
    throw new Error('Use a relative source path with forward slashes, up to 240 characters.');
  }
  const segments = value.split('/');
  for (const segment of segments) {
    const lower = segment.toLowerCase();
    if (!segment || segment === '.' || segment === '..' || /[. ]$/.test(segment) || deviceName.test(segment)) {
      throw new Error('The source path contains an unsafe or unsupported segment.');
    }
    if (deniedDirectories.has(lower) || (lower.startsWith('.env') && !['.env.example', '.env.template'].includes(lower)) || secretExtension.test(segment) || ['id_rsa','id_ed25519','.npmrc','.pypirc','.netrc'].includes(lower)) {
      throw new Error('Credentials, repository internals and dependency directories cannot be imported or edited.');
    }
  }
  return value;
}

export function validateProjectFiles(files: readonly {path:string;content:string}[]): void {
  if (files.length > CODING_MAX_FILES) throw new Error(`Projects support up to ${CODING_MAX_FILES} source files.`);
  const paths = new Set<string>();
  let total = 0;
  for (const file of files) {
    const path = validateProjectPath(file.path).toLowerCase();
    if (paths.has(path)) throw new Error('Source paths must be unique, including capitalization.');
    paths.add(path);
    const size = new TextEncoder().encode(file.content).byteLength;
    if (file.content.includes('\0') || size > CODING_MAX_FILE_BYTES) throw new Error('Source files must be text and no larger than 100 KB.');
    if (/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/.test(file.content)) throw new Error('Private-key content cannot be included in project source.');
    total += size;
  }
  if (total > CODING_MAX_PROJECT_BYTES) throw new Error('Project source must total 2 MB or less.');
  for (const path of paths) {
    const parts = path.split('/');
    for (let length=1;length<parts.length;length++) {
      if (paths.has(parts.slice(0,length).join('/'))) throw new Error('A source path cannot be both a file and a directory.');
    }
  }
}
