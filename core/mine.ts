import type { GraphTree } from '../types'

// hashes of commits made in this session, newest first, so the list stays small
export const MINE_CAP = 200

// `git rev-list` output (one hash per line) joins the list; a repeat moves to the front
export function addMine(prev: string[], out: string): string[] {
  const got = out.split('\n').map(l => l.trim()).filter(Boolean)
  return got.length === 0 ? prev : [...new Set([...got, ...prev])].slice(0, MINE_CAP)
}

// Worktrees whose HEAD moved between two snapshots, as before/after hashes (before '' for an unborn branch).
// Matched by path; a worktree added or removed in between has nothing to compare.
// ponytail: a commit made outside Claude, in another terminal, while a long Bash call ran is marked too
export function moved(before: GraphTree[], after: GraphTree[]): { before: string; after: string }[] {
  return after.flatMap(t => {
    const was = before.find(b => b.path === t.path)
    return was && was.head !== t.head ? [{ before: /^0+$/.test(was.head) ? '' : was.head, after: t.head }] : []
  })
}
