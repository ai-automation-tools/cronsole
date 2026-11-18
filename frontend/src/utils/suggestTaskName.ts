/**
 * A name for a task derived from what it runs, so the create form can fill the
 * Name field until the user types one. Returns '' when there is nothing useful
 * to say — the field then stays empty and required, never "Untitled".
 *
 *   powershell -File "D:\scripts\backup.ps1"  → backup
 *   https://api.example.com/health            → api.example.com health
 */
const SCRIPT_EXT = /\.(ps1|psm1|py|pyw|js|mjs|cjs|ts|bat|cmd|exe|sh|vbs|jar|rb)$/i;

export function suggestTaskName(text: string): string {
  const s = text.trim();
  // A `${secret.X}` reference is not a name — and is the one thing in a URL
  // field Cronsole would rather not echo into a label.
  if (!s || s.includes('${')) return '';
  if (/^https?:\/\//i.test(s)) {
    try {
      const url = new URL(s);
      const last = url.pathname.split('/').filter(Boolean).pop();
      return last ? `${url.hostname} ${last}` : url.hostname;
    } catch {
      return '';
    }
  }
  const tokens = (s.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(t => t.replace(/^["']|["']$/g, ''));
  // The script a command runs says more than the interpreter running it.
  const file = [...tokens].reverse().find(t => SCRIPT_EXT.test(t)) ?? tokens[0] ?? '';
  return (file.split(/[\\/]/).pop() ?? '').replace(SCRIPT_EXT, '');
}
