// hashes of commits made in this session, newest first, so the list stays small
export const MINE_CAP = 200

// `git rev-list` output (one hash per line) joins the list; a repeat moves to the front
export function addMine(prev: string[], out: string): string[] {
  const got = out.split('\n').map(l => l.trim()).filter(Boolean)
  return got.length === 0 ? prev : [...new Set([...got, ...prev])].slice(0, MINE_CAP)
}
