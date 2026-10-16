import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const SRC = join(process.cwd(), 'src');

export function sourceFiles(dir = SRC): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
export const rel = (p: string) => relative(SRC, p).replace(/\\/g, '/');
export const read = (p: string) => readFileSync(p, 'utf8');

/** يحذف التعليقات ويُبقي النصوص الحرفية (تعليق داخل نص لا يُحذف) */
export function stripComments(s: string): string {
  const out: string[] = [];
  let i = 0, q: string | null = null;
  while (i < s.length) {
    const c = s[i];
    if (q) {
      out.push(c);
      if (c === '\\') { out.push(s[i + 1] ?? ''); i += 2; continue; }
      if (c === q) q = null;
      i++; continue;
    }
    if (c === "'" || c === '"' || c === '`') { q = c; out.push(c); i++; continue; }
    if (s.startsWith('//', i)) { const j = s.indexOf('\n', i); i = j < 0 ? s.length : j; continue; }
    if (s.startsWith('/*', i)) { const j = s.indexOf('*/', i + 2); i = j < 0 ? s.length : j + 2; continue; }
    out.push(c); i++;
  }
  return out.join('');
}

export const STRING_LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
export const JSX_TEXT = />([^<>{}\n]+)</g;
