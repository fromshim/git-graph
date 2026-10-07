// Regenerates assets/*.svg from the mod's own layout: run `npx -y tsx scripts/preview.ts` from the repo root.
import { mkdirSync, writeFileSync } from 'node:fs'

import { SEP } from '../core/commands.ts'
import { AUTHOR_CELLS, layout } from '../core/layout.ts'
import type { Row } from '../core/layout.ts'
import { refChips, track } from '../core/refs.ts'
import { C, chip, personColor } from '../core/theme.ts'
import type { Seg } from '../core/theme.ts'
import type { GraphRefs } from '../types'

const NOW = 1_800_000_000_000
const W = 84 // pane columns (register.tsx uses 72; wider here so subjects survive the chips)
const FS = 14
const CHAR_W = 8.4
const ROW_H = 17
const FONT = "SF Mono, Menlo, Consolas, 'DejaVu Sans Mono', monospace"

// ---- fake history, newest first: hash, parents, decoration, author, minutes ago, subject ----
const H = (n: number) => (Math.imul(n, 2654435761) >>> 0).toString(16).padStart(8, '0').repeat(5)
const HISTORY: [number, number[], string, string, number, string][] = [
  [1, [5], 'HEAD -> feat/search', 'ana', 5, 'feat: highlight matches'],
  [2, [7], 'fix/login', 'ben', 40, 'fix: keep query on login'],
  [3, [8], 'origin/feat/pay', 'mia', 130, 'feat: add checkout form'],
  [4, [6, 9], 'main, origin/main', 'dev', 200, 'Merge pull request #12 from feat/export'],
  [5, [6], '', 'ana', 260, 'feat(search): add a fuzzy matcher'],
  [9, [6], 'feat/export', 'dev', 420, 'feat(export): write the graph as SVG'],
  [7, [10], '', 'ben', 1500, 'fix(auth): refresh the token before expiry'],
  [8, [10], '', 'mia', 2000, 'feat(payments): scaffold the billing module'],
  [6, [12], 'tag: v0.4.0', 'dev', 4300, 'chore(release): v0.4.0'],
  [12, [10], '', 'ana', 5800, 'test(layout): cover merge link rows'],
  [10, [11], '', 'dev', 14400, 'refactor: extract the theme palette'],
  [11, [13], '', 'ben', 31000, 'docs: describe the chip legend'],
  [13, [14], '', 'mia', 60000, 'ci: run the tests on every push'],
  [14, [15], '', 'ana', 120000, 'feat: draw lanes from parent hashes'],
  [15, [16], '', 'dev', 200000, 'chore: add the license'],
  [16, [], '', 'dev', 300000, 'chore: initial commit'],
]
const LOG = HISTORY.map(([n, parents, decor, author, mins, subject]) =>
  [H(n), parents.map(H).join(' '), H(n).slice(0, 7), decor, author, String(NOW / 1000 - mins * 60), subject].join(SEP),
)
const REFS: GraphRefs = {
  heads: ['main', 'feat/search', 'fix/login', 'feat/export'],
  tracks: { 'feat/search': track('[ahead 2, behind 1]'), 'fix/login': track('[ahead 1]') },
  trees: [
    { name: 'app', head: 'f'.repeat(40), isSelf: true },
    { name: 'hotfix', head: H(2), isSelf: false },
  ],
}
const CHANGED = 3
const MINE = new Set([H(1), H(5)]) // commits made in this session: marked ✦
const OPEN = H(4)
const CARD = {
  body: ['Merge pull request #12 from feat/export', 'Adds the SVG exporter and a --width flag.'],
  files: [['64', '0', 'core/export.ts'], ['12', '3', 'hooks/register.tsx'], ['9', '0', 'tests/export.test.ts'], ['2', '2', 'README.md']],
}

// ---- tiny SVG layer: every glyph sits at column * CHAR_W, so no font advance matters ----
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const cells = (ch: string) => (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠]/.test(ch) ? 2 : 1)
const width = (s: string) => [...s].reduce((n, ch) => n + cells(ch), 0)
const num = (n: number) => +n.toFixed(2)

type Style = { fill?: string; bold?: boolean; italic?: boolean; opacity?: number }
// Hangul runs (with the spaces/digits between Hangul) are one <text> with natural advance: a
// fallback font's Hangul is narrower than 2 cells, so per-glyph placement would gap the letters.
// Everything else sits glyph by glyph at column * CHAR_W.
const HANGUL_RUN = /[\uac00-\ud7a3](?:[\uac00-\ud7a3 0-9()]*[\uac00-\ud7a3)])?/gu
function text(col: number, row: number, s: string, st: Style = {}): string {
  const y = num(row * ROW_H + ROW_H * 0.78)
  const a = (x: string) => {
    const attrs = [`x="${x}"`, `y="${y}"`, `fill="${st.fill ?? C.fg}"`]
    if (st.bold) attrs.push('font-weight="700"')
    if (st.italic) attrs.push('font-style="italic"')
    if (st.opacity) attrs.push(`fill-opacity="${st.opacity}"`)
    return attrs.join(' ')
  }
  const out: string[] = []
  let xs: number[] = []
  let chars: string[] = []
  const flush = () => {
    if (chars.length) out.push(`<text ${a(xs.join(' '))}>${esc(chars.join(''))}</text>`)
    xs = []
    chars = []
  }
  const runs = new Map<number, string>() // char index -> Hangul run starting there
  for (const m of s.matchAll(HANGUL_RUN)) runs.set(m.index, m[0])
  let c = col
  for (let i = 0; i < s.length; ) {
    const run = runs.get(i)
    if (run) {
      flush()
      out.push(`<text ${a(String(num(c * CHAR_W)))}>${esc(run)}</text>`)
      c += width(run)
      i += run.length
      continue
    }
    const ch = String.fromCodePoint(s.codePointAt(i) ?? 32)
    if (ch !== ' ') (xs.push(num(c * CHAR_W)), chars.push(ch))
    c += cells(ch)
    i += ch.length
  }
  flush()
  return out.join('')
}
const rect = (col: number, row: number, cols: number, fill: string, rows = 1) =>
  `<rect x="${num(col * CHAR_W)}" y="${row * ROW_H}" width="${num(cols * CHAR_W)}" height="${rows * ROW_H}" fill="${fill}"/>`

// a Seg (graph cell run, chip) at a column; its background first; returns the markup and the next column
function seg(col: number, row: number, s: Seg): [string, number] {
  const w = width(s.text)
  const bg = s.backgroundColor ? rect(col, row, w, s.backgroundColor) : ''
  return [bg + text(col, row, s.text, { fill: s.color, bold: s.bold }), col + w]
}

// the cells of `s` that fit in `room`, ending in … like Ink's truncate-end
function fit(items: Seg[], room: number): Seg[] {
  const out: Seg[] = []
  let left = room
  const total = items.reduce((n, s) => n + width(s.text), 0)
  for (const s of items) {
    const w = width(s.text)
    if (total <= room || w <= left - 1) (out.push(s), (left -= w))
    else {
      out.push({ ...s, text: [...s.text].slice(0, Math.max(0, left - 1)).join('') + '…' })
      break
    }
  }
  return out
}

// svg wrapper; with a title it gets a thin terminal title bar
function svg(cols: number, rows: number, body: string[], title?: string): string {
  const w = num((cols + 2) * CHAR_W)
  const top = title ? 2 : 1
  const h = (rows + top + 1) * ROW_H
  const bar = title
    ? [C.red, C.yellow, C.green].map((c, i) => `<circle cx="${14 + i * 16}" cy="${ROW_H}" r="5" fill="${c}"/>`).join('') +
      `<text x="${w / 2}" y="${num(ROW_H + 5)}" text-anchor="middle" fill="${C.gray}">${esc(title)}</text>`
    : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}" font-size="${FS}">` +
    `<rect width="${w}" height="${h}" rx="10" fill="${C.bg}"/>${bar}<g transform="translate(${CHAR_W},${top * ROW_H})">${body.join('')}</g></svg>\n`
  )
}

// ---- the pane, composed like hooks/register.tsx ----
function preview(): string {
  const { rows, lanes } = layout(LOG, NOW, REFS, Infinity)
  const out: string[] = []
  let y = 0
  // top lines (register.tsx `top`): one bar with the fold button (once lanes > 3), 원격 확인 and 경로 강조, then the uncommitted count
  const bar = [...(lanes > 3 ? ['◂ 가지 접기'] : []), '원격 확인', '경로 강조']
  let at = 0
  for (const b of bar) (out.push(text(at, y, b, { opacity: 0.55 })), (at += width(b) + 2))
  y++
  if (CHANGED > 0) out.push(text(0, y, '◌ ', { fill: C.yellow }) + text(2, y++, `커밋 안 한 변경 ${CHANGED}개`))

  const commit = (r: Row) => {
    const isOpen = r.hash === OPEN
    if (r.isHead || isOpen) out.push(rect(0, y, W, C.sel))
    const put = (col: number, s: Seg) => {
      const [m, next] = seg(col, y, s)
      out.push(m)
      return next
    }
    let col = r.graph.reduce(put, 0)
    const right = W - 20
    const head = r.isHead ? [chip('HEAD', C.blue), ...r.refs] : r.refs
    const items: Seg[] = [...head.flatMap(s => [s, { text: ' ' }]), ...(MINE.has(r.hash) ? [{ text: '✦ ', color: C.yellow }] : []), { text: r.subject, color: r.isHead ? C.white : C.fg, bold: r.isHead }]
    fit(items, right - col).reduce(put, col)
    // right block (register.tsx): margin 1, author chip, short hash, age
    const author = ` ${r.author.padEnd(AUTHOR_CELLS)} `
    out.push(rect(right + 1, y, width(author), personColor(r.author)) + text(right + 1, y, author, { fill: C.bg }))
    out.push(text(right + 1 + width(author), y, ` ${r.short}`, isOpen ? {} : { opacity: 0.5 }))
    out.push(text(right + 1 + width(author) + 8, y, ` ${r.age.padStart(3)}`, { fill: C.gray }))
    y++
  }

  for (const r of rows) {
    if (!r.hash) {
      let col = 0
      for (const s of r.graph) {
        const [m, next] = seg(col, y, s)
        out.push(m)
        col = next
      }
      y++
      continue
    }
    commit(r)
    if (r.hash === OPEN) y = card(out, y)
  }
  return svg(W, y, out, 'Git graph')
}

// the expanded commit card (register.tsx `card`): round border in C.sel, marginLeft 2, paddingX 1
function card(out: string[], y0: number): number {
  const L = 2
  const inner = W - L - 2
  const adds = CARD.files.reduce((n, f) => n + Number(f[0]), 0)
  const dels = CARD.files.reduce((n, f) => n + Number(f[1]), 0)
  const [title = '', ...more] = CARD.body
  const edge = (y: number, l: string, r: string) => out.push(text(L, y, l + '─'.repeat(inner) + r, { fill: C.sel }))
  const side = (y: number) => out.push(text(L, y, '│', { fill: C.sel }), text(W - 1, y, '│', { fill: C.sel }))
  let y = y0
  edge(y++, '╭', '╮')
  const body: string[] = []
  const x = L + 2
  const line = (f: (y: number) => string) => (side(y), body.push(f(y)), y++)
  line(r => text(x, r, title, { fill: C.white, bold: true }))
  for (const m of more) line(r => text(x, r, m))
  line(r => {
    const label = `파일 ${CARD.files.length}개 `
    const add = `+${adds}`
    return text(x, r, label, { fill: C.gray }) + text(x + width(label), r, add, { fill: C.green }) + text(x + width(label) + add.length + 1, r, `−${dels}`, { fill: C.red })
  })
  for (const [a = '', d = '', path = ''] of CARD.files)
    line(r => {
      const cut = path.lastIndexOf('/') + 1
      const ad = `+${a}`.padStart(5)
      const de = ` −${d}`.padEnd(6)
      return text(x, r, ad, { fill: C.green }) + text(x + 5, r, de, { fill: C.red }) + text(x + 11, r, path.slice(0, cut), { fill: C.gray }) + text(x + 11 + cut, r, path.slice(cut))
    })
  // the hand-to-Claude buttons (register.tsx): 설명, 리뷰, HEAD 와 비교
  line(r => {
    let c = x
    // each on a C.sel block with one cell of padding, one cell apart
    return ['설명', '리뷰', 'HEAD 와 비교'].map(b => {
      const at = c
      c += width(b) + 3
      return rect(at, r, width(b) + 2, C.sel) + text(at + 1, r, b)
    }).join('')
  })
  edge(y++, '╰', '╯')
  out.push(...body)
  return y
}

// ---- chip legend ----
const LEGEND: Record<'ko' | 'en', string[]> = {
  ko: ['현재 체크아웃한 커밋', '로컬 브랜치', 'origin 과 같은 커밋', 'origin 보다 앞서거나 뒤처진 커밋 수', '원격 브랜치', '태그', '워크트리 (둘 이상일 때만)'],
  en: ['checked-out commit', 'local branch', 'same commit as origin', 'commits ahead of / behind origin', 'remote branch', 'tag', 'worktree (only when there are several)'],
}
function legend(lang: 'ko' | 'en'): string {
  const one = (decor: string, known: GraphRefs, hash = '') => refChips(decor, hash, known).chips
  const none: GraphRefs = { heads: ['name'], tracks: {}, trees: [] }
  const chips: Seg[][] = [
    [{ text: '●', color: C.blue }, chip('HEAD', C.blue)],
    one('name', none),
    one('name, origin/name', none),
    one('name', { ...none, tracks: { name: track('[ahead 2, behind 1]') } }),
    one('origin/name', none),
    one('tag: name', none),
    one('', { ...none, trees: [{ name: 'name', head: 'h', isSelf: false }, { name: 'other', head: 'x', isSelf: false }] }, 'h'),
  ]
  const out: string[] = []
  chips.forEach((cs, i) => {
    let col = 1
    for (const s of cs) {
      const [m, next] = seg(col, i * 1.5, s)
      out.push(m)
      col = next + (s.backgroundColor ? 0 : 1)
    }
    out.push(text(20, i * 1.5, LEGEND[lang][i] ?? ''))
  })
  const cols = 20 + Math.max(...LEGEND[lang].map(width)) + 1
  return svg(cols, chips.length * 1.5, out)
}

mkdirSync('assets', { recursive: true })
writeFileSync('assets/preview.svg', preview())
writeFileSync('assets/legend.ko.svg', legend('ko'))
writeFileSync('assets/legend.en.svg', legend('en'))
console.log('wrote assets/preview.svg, assets/legend.ko.svg, assets/legend.en.svg')
