import type { GraphRefs } from '../types'
import { SEP } from './commands.ts'
import { NO_REFS, age, refChips } from './refs.ts'
import { C, LANES } from './theme.ts'
import type { Seg } from './theme.ts'

export const AUTHOR_CELLS = 5

// a row that only bends lanes: no commit on it
const LINK_ROW = { hash: '', short: '', refs: [], isHead: false, author: '', age: '', subject: '' }

export type Row = { graph: Seg[]; hash: string; short: string; refs: Seg[]; isHead: boolean; author: string; age: string; subject: string }

type Lane = { hash: string; color: string } | null
// a cell is the set of sides its line reaches; the box glyph follows from the set
type Cell = { dirs: number; color?: string; node?: string }
const U = 1, D = 2, L = 4, R = 8
const BOX: Record<number, string> = {
  [U | D]: '│', [L | R]: '─', [U | D | L | R]: '┼', [D | L]: '╮', [D | R]: '╭', [U | L]: '╯', [U | R]: '╰',
  [U | D | L]: '┤', [U | D | R]: '├', [D | L | R]: '┬', [U | L | R]: '┴',
}

function toSegs(cells: Cell[], width: number): Seg[] {
  const segs: Seg[] = []
  for (let i = 0; i < width; i++) {
    const cell = cells[i]
    const ch = !cell ? ' ' : cell.node ?? BOX[cell.dirs] ?? '┼'
    const color = cell?.color
    const last = segs[segs.length - 1]
    if (last && last.color === color) last.text += ch
    else segs.push({ text: ch, color })
  }
  return segs
}

// Lays out one row per commit from parent hashes, as GUI clients do: each lane keeps
// its own color for its whole life, forks and merges bend inside the commit's row
// (forks off a merge, or several forks at once, get link rows of their own above it).
// ponytail: lanes never shift left to fill gaps; a freed slot is reused by the next new lane
// Past `maxLanes` the rest fold into one column: ┆ while a hidden lane runs, the commit's
// own node when the commit sits on a hidden lane.
export function layout(log: string[], now: number, known: GraphRefs = NO_REFS, maxLanes = Infinity): { rows: Row[]; lanes: number } {
  const lanes: Lane[] = []
  let hue = 0
  const newColor = () => LANES[hue++ % LANES.length] ?? C.blue
  const free = () => {
    const i = lanes.findIndex(l => l === null)
    return i < 0 ? lanes.push(null) - 1 : i
  }
  const built: { cells: Cell[]; at?: number; row: Omit<Row, 'graph'> }[] = []
  const grid = () => {
    const cells: Cell[] = []
    const mark = (x: number, dirs: number, c: string) => {
      const was = cells[x]
      cells[x] = { dirs: (was?.dirs ?? 0) | dirs, color: was?.dirs === (U | D) ? was.color : c }
    }
    const across = (from: number, to: number, c: string) => {
      for (let x = Math.min(from, to) * 2 + 1; x < Math.max(from, to) * 2; x++) mark(x, L | R, c)
    }
    return { cells, mark, across }
  }
  type Grid = ReturnType<typeof grid>

  for (const line of log) {
    const [hash = '', parentList = '', short = '', decor = '', author = '', ct = '0', ...rest] = line.split(SEP)
    if (!hash) continue
    const parents = parentList.split(' ').filter(Boolean)
    const before = [...lanes]
    let at = lanes.findIndex(l => l?.hash === hash)
    const hasUp = at >= 0
    if (at < 0) {
      at = free()
      lanes[at] = { hash, color: newColor() }
    }
    const color = lanes[at]?.color ?? C.blue
    // other lanes waiting for this commit end here: branches that forked off it
    const joins = before.flatMap((l, j) => (l && j !== at && l.hash === hash ? [j] : []))
    const join = (g: Grid, j: number) => {
      const c = before[j]?.color ?? color
      g.across(at, j, c)
      g.mark(j * 2, U | (j > at ? L : R), c)
      lanes[j] = null
    }
    let passing = before
    // forks get link rows of their own, one per fork, nearest first so no two cross,
    // whenever the commit has more than one or is also a merge: a branch that ends and
    // one that starts never meet in one ┤, ┴ or ┼
    const isSplit = joins.length > 1 || (joins.length > 0 && parents.length > 1)
    if (isSplit) {
      let hasLine = hasUp
      for (const j of [...joins].sort((a, b) => Math.abs(a - at) - Math.abs(b - at))) {
        const link = grid()
        lanes.forEach((l, i) => {
          if (l && i !== at && i !== j) link.mark(i * 2, U | D, l.color)
        })
        join(link, j)
        link.mark(at * 2, (hasLine ? U : 0) | D | (j > at ? R : L), color)
        built.push({ cells: link.cells, row: LINK_ROW })
        hasLine = true
      }
      passing = [...lanes]
    }

    const g = grid()
    const { cells, mark, across } = g
    passing.forEach((l, i) => {
      if (l && i !== at && l.hash !== hash) mark(i * 2, U | D, l.color)
    })
    if (!isSplit) joins.forEach(j => join(g, j))
    lanes[at] = parents[0] ? { hash: parents[0], color } : null
    // a merge's other parents: join a lane already waiting for it, or open a new one
    for (const p of parents.slice(1)) {
      const k = lanes.findIndex(l => l?.hash === p)
      if (k >= 0) {
        const c = lanes[k]?.color ?? color
        across(at, k, c)
        mark(k * 2, U | D | (k > at ? L : R), c)
      } else {
        const n = free()
        const c = newColor()
        lanes[n] = { hash: p, color: c }
        across(at, n, c)
        mark(n * 2, D | (n > at ? L : R), c)
      }
    }
    const { chips, isHead } = refChips(decor, hash, known)
    // every commit is a tick on its lane, so the line runs through it; HEAD alone is a dot
    const tick = hasUp || isSplit ? (parents[0] ? '┿' : '┷') : parents[0] ? '┯' : '━'
    cells[at * 2] = { dirs: 0, color, node: isHead ? '●' : tick }
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()

    const name = author.split(/[\s_.@-]/)[0] || author
    built.push({
      cells,
      at,
      row: { hash, short, refs: chips, isHead, author: name.slice(0, AUTHOR_CELLS), age: age(Number(ct), now), subject: rest.join(SEP) },
    })
  }

  const full = Math.max(0, ...built.map(b => b.cells.length))
  const count = Math.ceil(full / 2)
  if (count <= maxLanes) return { rows: built.map(b => ({ ...b.row, graph: toSegs(b.cells, full + 1) })), lanes: count }
  const keep = maxLanes * 2
  const rows = built.map(b => {
    const hidden = b.cells.slice(keep)
    const node = b.at !== undefined && b.at >= maxLanes ? b.cells[b.at * 2] : undefined
    const more: Cell | undefined = node ?? (hidden.some(Boolean) ? { dirs: 0, color: C.gray, node: '┆' } : undefined)
    return { ...b.row, graph: toSegs([...b.cells.slice(0, keep), more].map(c => c ?? { dirs: 0, node: ' ' }), keep + 2) }
  })
  return { rows, lanes: count }
}
