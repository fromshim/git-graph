// what the card buttons put in the prompt box; the person edits it, then sends
export const explain = (short: string) => `커밋 ${short} 을 설명해줘`
export const review = (short: string) => `커밋 ${short} 을 리뷰해줘`
export const compare = (short: string) => `커밋 ${short} 부터 HEAD 까지 바뀐 점을 정리해줘`
export const COMMIT_MESSAGE = '지금 변경을 커밋 메시지로 정리해줘'

// a file line inserts `@path `; numstat writes a rename as `a => b` or `d/{a => b}/x`: take the new side
export function mention(path: string): string {
  const to = path
    .replace(/\{[^{}]* => ([^{}]*)\}/g, '$1')
    .replace(/\/\//g, '/')
  return `@${to.includes(' => ') ? to.slice(to.lastIndexOf(' => ') + 4) : to} `
}
