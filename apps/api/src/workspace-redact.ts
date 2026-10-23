/** Best-effort redaction complements secret-path exclusions; it is not a secret scanner. */
export function redactWorkspaceText(value:string):string {
  return value
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/g,'[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9_.+/=-]{16,}/gi,'$1[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?)[A-Za-z0-9_+./=-]{12,}/gi,'$1[REDACTED]');
}
