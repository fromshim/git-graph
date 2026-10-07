import { SEP } from './commands.ts'
import { C } from './theme.ts'
import type { Seg } from './theme.ts'

// Hashes of HEAD and its ancestors among the loaded log lines (parents followed through the lines);
// null when HEAD is not among them, so nothing is dimmed.
export function ancestors(log: string[]): Set<string> | null {
  const parents = new Map<string, string[]>()
  let head = ''
  for (const line of log) {
    const [hash = '', list = '', , decor = ''] = line.split(SEP)
    if (!hash) continue
    parents.set(hash, list.split(' ').filter(Boolean))
    if (decor.split(', ').some(r => r === 'HEAD' || r.startsWith('HEAD -> '))) head = hash
  }
  if (!head) return null
  const seen = new Set<string>()
  const todo = [head]
  for (let h = todo.pop(); h !== undefined; h = todo.pop()) {
    if (seen.has(h)) continue
    seen.add(h)
    todo.push(...(parents.get(h) ?? []))
  }
  return seen
}

// every color of a row goes theme gray; blanks (no color) stay blank, and a chip keeps its dark text on a gray block
export const dim = (segs: Seg[]): Seg[] =>
  segs.map(s => ({ ...s, color: s.backgroundColor ? s.color : s.color && C.gray, backgroundColor: s.backgroundColor && C.gray }))
