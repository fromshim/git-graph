import type { GraphRefs, GraphTree } from '../types'
import { C, chip } from './theme.ts'
import type { Seg } from './theme.ts'

export const NO_REFS: GraphRefs = { heads: [], tracks: {}, trees: [] }

// local ⎇ (= when origin points at the same commit, ↑↓ when it does not), remote ⌂, tag #,
// worktree ⑂ (only once there is more than one)
export function refChips(decor: string, hash = '', known: GraphRefs = NO_REFS): { chips: Seg[]; isHead: boolean } {
  const list = decor ? decor.split(', ') : []
  const isHead = list.some(r => r === 'HEAD' || r.startsWith('HEAD -> '))
  const names = list.map(r => r.replace(/^HEAD -> /, '')).filter(r => r !== 'HEAD' && r !== 'origin/HEAD')
  // a local name may hold a slash (feat/x): known heads decide; without them, origin/ marks remote
  const isLocal = (r: string) => (known.heads.length > 0 ? known.heads.includes(r) : !r.startsWith('origin/'))
  const locals = new Set(names.filter(r => !r.startsWith('tag: ') && isLocal(r)))
  const trees = known.trees.length > 1 ? known.trees.filter(t => t.head === hash) : []
  const chips: Seg[] = trees.map(t => chip(`⑂ ${t.name}`, C.purple))
  for (const r of names) {
    if (r.startsWith('tag: ')) chips.push(chip(`# ${r.slice(5)}`, C.orange))
    else if (r.startsWith('origin/') && locals.has(r.slice(7))) continue
    else if (!locals.has(r)) chips.push(chip(`⌂ ${r}`, C.red))
    else {
      const sync = names.includes(`origin/${r}`) ? '=' : known.tracks[r] ?? ''
      chips.push(chip(sync ? `⎇ ${r} ${sync}` : `⎇ ${r}`, C.green))
    }
  }
  return { chips, isHead }
}

// `for-each-ref %(upstream:track)`: "[ahead 2, behind 1]" -> "↑2 ↓1"; "[gone]" and "" -> ""
export function track(raw: string): string {
  const ahead = /ahead (\d+)/.exec(raw)?.[1]
  const behind = /behind (\d+)/.exec(raw)?.[1]
  return [ahead && `↑${ahead}`, behind && `↓${behind}`].filter(Boolean).join(' ')
}

// `worktree list --porcelain`: blocks of "worktree <path>", "HEAD <sha>", "branch …" | "detached"
export function trees(out: string, top: string): GraphTree[] {
  return out.split('\n\n').flatMap(block => {
    const path = /^worktree (.+)$/m.exec(block)?.[1]
    const head = /^HEAD ([0-9a-f]+)$/m.exec(block)?.[1]
    if (!path || !head) return []
    return [{ name: path.slice(path.lastIndexOf('/') + 1), head, isSelf: path === top }]
  })
}

export function age(seconds: number, now: number): string {
  const s = Math.max(0, Math.floor(now / 1000) - seconds)
  for (const [unit, size] of [['y', 31536000], ['mo', 2592000], ['w', 604800], ['d', 86400], ['h', 3600], ['m', 60]] as const)
    if (s >= size) return `${Math.floor(s / size)}${unit}`
  return 'now'
}
