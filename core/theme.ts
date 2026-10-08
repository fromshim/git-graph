export type Seg = { text: string; color?: string; backgroundColor?: string; bold?: boolean }

// Atom One Dark
export const C = {
  bg: '#282c34', fg: '#abb2bf', white: '#dcdfe4', gray: '#5c6370', sel: '#3e4451', hover: '#2c313a',
  red: '#e06c75', green: '#98c379', yellow: '#e5c07b', orange: '#d19a66', blue: '#61afef', purple: '#c678dd', cyan: '#56b6c2',
}
// lanes take every hue; chips keep their own: branch green, remote red, tag orange, worktree purple (this session's own blue),
// people blue/purple/cyan
export const LANES = [C.blue, C.orange, C.purple, C.green, C.cyan, C.red, C.yellow]
export const PEOPLE = [C.blue, C.purple, C.cyan]

export const chip = (text: string, backgroundColor: string): Seg => ({ text: ` ${text} `, backgroundColor, color: C.bg, bold: true })

export function personColor(name: string): string {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0
  return PEOPLE[Math.abs(h) % PEOPLE.length] ?? C.blue
}
