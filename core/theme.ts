export type Seg = { text: string; color?: string; backgroundColor?: string; bold?: boolean }

// Atom One Dark
export const C = {
  bg: '#282c34', fg: '#abb2bf', white: '#dcdfe4', gray: '#5c6370', sel: '#3e4451', hover: '#2c313a',
  red: '#e06c75', green: '#98c379', yellow: '#e5c07b', orange: '#d19a66', blue: '#61afef', purple: '#c678dd', cyan: '#56b6c2',
  // HEAD's dot and this session's worktree: a yellow brighter than C.yellow, so it reads as a glow
  glow: '#ffd866',
}
// lanes take every hue; chips keep their own: branch green, remote red, tag orange, worktree purple (this session's own yellow),
// people blue/purple/cyan
export const LANES = [C.blue, C.orange, C.purple, C.green, C.cyan, C.red, C.yellow]
export const PEOPLE = [C.blue, C.purple, C.cyan]

export const rgb = (hex: string) => parseInt(hex.slice(1), 16)
// 0x00RRGGBB halfway between two colors: t = 0 is a, t = 1 is b
export const mix = (a: number, b: number, t: number) =>
  [16, 8, 0].reduce((out, shift) => out | (Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t) << shift), 0)
// a dark tint of `color`: it mixed into the pane's background, so a light label stays readable on it
export const tint = (color: string, ratio = 0.28, base = C.bg) => `#${mix(rgb(base), rgb(color), ratio).toString(16).padStart(6, '0')}`

export const chip = (text: string, backgroundColor: string): Seg => ({ text: ` ${text} `, backgroundColor, color: C.bg, bold: true })

export function personColor(name: string): string {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0
  return PEOPLE[Math.abs(h) % PEOPLE.length] ?? C.blue
}
