// what the card buttons put in the prompt box; the person edits it, then sends
export const explain = (short: string) => `커밋 ${short} 을 설명해줘`
export const review = (short: string) => `커밋 ${short} 을 리뷰해줘`
export const compare = (short: string) => `커밋 ${short} 부터 HEAD 까지 바뀐 점을 정리해줘`
const DIRTY = '커밋 안 한 변경이 있으면 커밋 / stash / 그대로 들고 가기 중 어떻게 할지 먼저 물어봐줘'
export const checkout = (name: string) => `${name} 브랜치로 체크아웃해줘. ${DIRTY}`
export const checkoutRemote = (remote: string) => `${remote} 를 체크아웃해줘. 로컬 브랜치가 없으면 추적 브랜치로 만들어줘. ${DIRTY}`
// a branch on the commit beats a detached HEAD: one is named, several are asked about
export const checkoutCommit = (short: string, branches: string[] = []) =>
  branches.length === 0 ? `커밋 ${short} 으로 체크아웃해줘. detached HEAD 가 되니 새 브랜치를 만들지 먼저 물어봐줘. ${DIRTY}`
  : branches.length === 1 ? `커밋 ${short} 을 가리키는 ${branches[0]} 브랜치로 체크아웃해줘. ${DIRTY}`
  : `커밋 ${short} 을 가리키는 브랜치 ${branches.join(', ')} 중 어디로 체크아웃할지 먼저 물어봐줘. ${DIRTY}`
export const pull = (name: string) => `${name} 브랜치를 pull 해줘. ${DIRTY}`
export const push = (name: string) => `${name} 브랜치를 push 해줘`
export const COMMIT_MESSAGE = '지금 변경을 커밋 메시지로 정리해줘'

// a file line inserts `@path `; numstat writes a rename as `a => b` or `d/{a => b}/x`: take the new side
export function mention(path: string): string {
  const to = path
    .replace(/\{[^{}]* => ([^{}]*)\}/g, '$1')
    .replace(/\/\//g, '/')
  return `@${to.includes(' => ') ? to.slice(to.lastIndexOf(' => ') + 4) : to} `
}
