import type { GraphFile } from '../types'
import { parseNumstat } from './show.ts'

export const NEW = 'new'

// `git diff --numstat HEAD` (tracked) then the `??` lines of `git status --porcelain` (untracked, add 'new')
// ponytail: an untracked folder is one line (`dir/`), as porcelain shows it; -uall if files are wanted
export function parseChanges(numstat: string, porcelain: string): GraphFile[] {
  const fresh = porcelain.split('\n').flatMap(l => {
    const m = /^\?\? (.+)$/.exec(l)
    return m ? [{ add: NEW, del: '', path: (m[1] ?? '').replace(/^"(.*)"$/, '$1') }] : []
  })
  return [...parseNumstat(numstat), ...fresh]
}
