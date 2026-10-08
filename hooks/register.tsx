import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, RenderInput, Timer } from 'claude-code'

import { DIFF, FETCH, FETCH_ENV, GIT, STATUS, TOP, TRACKS, TREES, added, show, statusIn } from '../core/commands.ts'
import { AUTHOR_CELLS, layout } from '../core/layout.ts'
import type { Row } from '../core/layout.ts'
import { ancestors, dim } from '../core/ancestry.ts'
import { NEW, parseChanges } from '../core/changes.ts'
import { addMine, moved } from '../core/mine.ts'
import { grown } from '../core/remote.ts'
import { pointers, track, trees, treesAt } from '../core/refs.ts'
import { COMMIT_MESSAGE, compare, explain, mention, review } from '../core/prompt.ts'
import { PULSE_MS, breath, dotCells, splitDot } from '../core/pulse.ts'
import { parseShow } from '../core/show.ts'
import { C, chip, personColor, tint } from '../core/theme.ts'
import type { Seg } from '../core/theme.ts'
import type { GraphDetail, GraphLines, GraphRefs, GraphTree } from '../types'

const PANE = 'git-graph'
const lines = atom({ plugin: 'git-graph', key: 'lines' } as const, [])
const note = atom({ plugin: 'git-graph', key: 'note' } as const, '')
const dirty = atom({ plugin: 'git-graph', key: 'dirty' } as const, 0)
const open = atom({ plugin: 'git-graph', key: 'open' } as const, '')
const detail = atom({ plugin: 'git-graph', key: 'detail' } as const, null)
const refs = atom({ plugin: 'git-graph', key: 'refs' } as const, { heads: [], tracks: {}, trees: [] })
const wide = atom({ plugin: 'git-graph', key: 'wide' } as const, false)
const isDirtyOpen = atom({ plugin: 'git-graph', key: 'isDirtyOpen' } as const, false)
// the commit whose ref list is open under its row
const refOpen = atom({ plugin: 'git-graph', key: 'refOpen' } as const, '')
const treeChanges = atom({ plugin: 'git-graph', key: 'treeChanges' } as const, {})
const changes = atom({ plugin: 'git-graph', key: 'changes' } as const, null)
const isTraced = atom({ plugin: 'git-graph', key: 'isTraced' } as const, false)
const isWatching = atom({ plugin: 'git-graph', key: 'isWatching' } as const, false)
const mine = atom({ plugin: 'git-graph', key: 'mine' } as const, [])

const FOLDED_LANES = 3
const WIDE = 72
// ponytail: a pane tree is capped at 20000 nodes; 150 commits and 30 files keep well under it
const MAX_FILES = 30

async function refresh($: EngineInterface) {
  const r = await $.process.run(GIT).catch(() => undefined)
  const got: GraphLines = r?.exitCode === 0 ? r.stdout.trimEnd().split('\n') : []
  const msg = !r ? 'git 실행 실패' : r.exitCode !== 0 ? 'git 저장소가 아니에요' : ''
  const st = msg ? undefined : await $.process.run(STATUS).catch(() => undefined)
  const changed = st?.exitCode === 0 ? st.stdout.split('\n').filter(Boolean).length : 0
  const [tr, wt, top] = msg ? [] : await Promise.all([TRACKS, TREES, TOP].map(argv => $.process.run(argv).catch(() => undefined)))
  const heads = (tr?.stdout ?? '').split('\n').map(l => l.split('\t')[0] ?? '').filter(Boolean)
  const known: GraphRefs = {
    heads,
    tracks: Object.fromEntries(
      (tr?.stdout ?? '').split('\n').flatMap(l => {
        const [name = '', raw = ''] = l.split('\t')
        const t = track(raw)
        return name && t ? [[name, t]] : []
      }),
    ),
    trees: trees(wt?.stdout ?? '', (top?.stdout ?? '').trim()),
  }
  await update($, refs, prev => (JSON.stringify(prev) === JSON.stringify(known) ? prev : known))
  // ponytail: skip writes when nothing moved, so the pane redraws only on change
  await update($, note, prev => (prev === msg ? prev : msg))
  await update($, dirty, prev => (prev === changed ? prev : changed))
  if (changed > 0 && (await read($, isDirtyOpen))) await loadChanges($)
  const listed = treesAt(await read($, refOpen), known)
  if (listed.length > 0) await loadTreeChanges($, listed)
  await update($, lines, prev => (prev.join('\n') === got.join('\n') ? prev : got))
}

// the uncommitted files: tracked ones from the diff against HEAD, untracked ones from status
async function loadChanges($: EngineInterface) {
  const [d, st] = await Promise.all([DIFF, STATUS].map(argv => $.process.run(argv).catch(() => undefined)))
  const got = parseChanges(d?.exitCode === 0 ? d.stdout : '', st?.exitCode === 0 ? st.stdout : '')
  await update($, changes, prev => (JSON.stringify(prev) === JSON.stringify(got) ? prev : got))
}

// uncommitted line count per worktree, only while a ref list is open; a failed run reads "?"
async function loadTreeChanges($: EngineInterface, list: GraphTree[]) {
  const got = Object.fromEntries(
    await Promise.all(
      list.map(async t => {
        const r = await $.process.run(statusIn(t.path)).catch(() => undefined)
        return [t.path, r?.exitCode === 0 ? String(r.stdout.split('\n').filter(Boolean).length) : '?'] as const
      }),
    ),
  )
  await update($, treeChanges, prev => (JSON.stringify(prev) === JSON.stringify(got) ? prev : got))
}

// the ref list of one commit, one at a time: a press on another row moves it
async function toggleRefs($: EngineInterface, hash: string) {
  let isOpening = false
  await update($, refOpen, prev => ((isOpening = prev !== hash) ? hash : ''))
  if (!isOpening) return
  await update($, treeChanges, () => ({}))
  await loadTreeChanges($, treesAt(hash, await read($, refs)))
}

async function toggleChanges($: EngineInterface) {
  let isOpening = false
  await update($, isDirtyOpen, prev => (isOpening = !prev))
  if (isOpening) await loadChanges($)
}

// HEAD's ● glows: frames are made once, a timer blits the next one (no redraw)
const FRAMES = breath().map(fg => dotCells(fg))
const PULSE_KEY = 'pulse'
const MAX_MISSES = 5
let pulse: Timer | undefined
let phase = 0
let misses = 0

function stopPulse() {
  pulse?.cancel()
  pulse = undefined
}

// never throws; a few denials in a row (the pane is closed or not mounted) stop the timer, the next drawing restarts it
async function beat($: EngineInterface) {
  phase = (phase + 1) % FRAMES.length
  const r = await $.ui.blit({ requestId: PANE, key: PULSE_KEY, cells: FRAMES[phase] ?? '' }).catch(() => ({ deny: 'blit failed' }))
  misses = r.deny ? misses + 1 : 0
  if (misses >= MAX_MISSES) stopPulse()
}

// one timer at most
function startPulse($: EngineInterface) {
  if (pulse) return
  misses = 0
  pulse = $.clock.every(PULSE_MS, () => void beat($))
}

// Did the surface ask us to draw the pane? A desktop that never does shows only "Nothing to show yet",
// so after a few seconds we say so (module variables: reset at each session.start)
const RENDER_WAIT = 5000
let rendered = false
let faults = new Set<string>()
let watchdog: Timer | undefined

function expectRender($: EngineInterface) {
  watchdog?.cancel()
  watchdog = $.clock.after(RENDER_WAIT, () => {
    void (async () => {
      if (rendered) return
      const mine = (await $.ui.panes().catch(() => [])).find(p => p.id === PANE)
      // the person closed it meanwhile: nothing was owed
      if (!mine) return
      $.ui.toast(`git-graph: 패널 그리기 요청을 받지 못했어요 (표시 ${mine.isShown ? '예' : '아니오'}, 배치 ${mine.isPlaced ? '예' : '아니오'})`)
    })()
  })
}

const FETCH_EVERY = 60_000
let watch: Timer | undefined
let isChecking = false
let isFetchDown = false

// fetch, refresh, and toast when a local branch fell further behind its upstream; never throws
async function check($: EngineInterface) {
  if (isChecking) return
  isChecking = true
  try {
    const before = (await read($, refs)).tracks
    const r = await $.process.run(FETCH, { env: FETCH_ENV, timeoutMs: 30_000 }).catch(() => undefined)
    if (r?.exitCode !== 0) {
      // one toast per failure streak
      if (!isFetchDown) $.ui.toast('원격을 가져오지 못했어요 (git fetch 실패)')
      isFetchDown = true
      return
    }
    isFetchDown = false
    await refresh($)
    const news = grown(before, (await read($, refs)).tracks)
    if (news.length > 0) $.ui.toast(`origin 에 새 커밋: ${news.join(', ')}`)
  } catch {
    // a failed check must not reach the pane
  } finally {
    isChecking = false
  }
}

async function toggleWatch($: EngineInterface) {
  let isOn = false
  await update($, isWatching, prev => (isOn = !prev))
  watch?.cancel()
  watch = undefined
  if (!isOn) return
  isFetchDown = false
  watch = $.clock.every(FETCH_EVERY, () => void check($))
  void check($)
}

// every worktree's HEAD, so a commit made in any of them (a subagent's) shows
async function heads($: EngineInterface) {
  const r = await $.process.run(TREES).catch(() => undefined)
  return trees(r?.exitCode === 0 ? r.stdout : '', '')
}

async function toggle($: EngineInterface, hash: string, short: string) {
  let isOpening = false
  await update($, open, prev => ((isOpening = prev !== hash) ? hash : ''))
  if (!isOpening) return
  await update($, detail, () => ({ hash, body: '', files: [], isLoading: true }))
  // -m --first-parent: a merge lists what it brought onto its first parent
  const r = await $.process.run(show(hash)).catch(() => undefined)
  const got = r?.exitCode === 0 ? parseShow(hash, r.stdout) : { hash, body: `${short}: 커밋을 읽지 못했어요`, files: [], isLoading: false }
  await update($, detail, prev => (prev?.hash === hash ? got : prev))
}

// puts text in the prompt box (never sends it); says so when the box could not take it
async function say($: EngineInterface, text: string, mode: 'replace' | 'insert' = 'replace') {
  const r = await $.prompt.fill({ text, mode }).catch(() => undefined)
  if (!r?.isFilled) $.ui.toast('프롬프트 입력창에 넣지 못했어요')
}

// the pane's drawing; a throw here is caught by the hook below
async function paint($: EngineInterface, e: RenderInput<'Pane'>) {
  const els = $.ui.resolve(e)
  const { Box, Text, Button } = els
  // the pulsing dot is the terminal's alone (Raster); elsewhere HEAD keeps the plain ●
  // (every table is completed with the others' names, drawn as fragments: ask the surface, not the table)
  const Raster = e.surface === 'terminal' && 'Raster' in els ? els.Raster : undefined
  // a remote surface (the desktop) scrolls its pane itself and may send no window: read it as the top
  const scroll = e.props.scroll ?? { offset: 0, bodyRows: e.viewport?.rows ?? 30 }
  const msg = await read($, note)

  if (msg)
    return (
      <Box height={scroll.bodyRows} justifyContent="center" alignItems="center">
        <Text color={C.white}>{msg}</Text>
      </Box>
    )

  const isWide = await read($, wide)
  const known = await read($, refs)
  const { rows, lanes } = layout(await read($, lines), Date.now(), known, isWide ? Infinity : FOLDED_LANES)
  const changed = await read($, dirty)
  const openHash = await read($, open)
  const shown = await read($, detail)
  const isChangesOpen = await read($, isDirtyOpen)
  const refHash = await read($, refOpen)
  const treeStatus = await read($, treeChanges)
  const files = await read($, changes)
  const isWatch = await read($, isWatching)
  const isOn = await read($, isTraced)
  const kin = isOn ? ancestors(await read($, lines)) : null
  const made = new Set(await read($, mine))
  const seg = ({ text, ...style }: Seg) => <Text {...style}>{text}</Text>

  // a file line: its columns, the folder dim, the name a button that puts @path in the prompt box
  const fileLine = (key: string, path: string, cut: number, cols: RenderChildren) => (
    <Box key={`row:${key}`} overflow="hidden">
      <Text wrap="truncate-start">
        {cols}
        <Text color={C.gray}>{path.slice(0, cut)}</Text>
      </Text>
      <Button key={key} plain hover={{ color: C.blue }} onPress={() => void say($, mention(path), 'insert')}>
        {path.slice(cut)}
      </Button>
    </Box>
  )

  // what points at this commit, under its row: each branch with its origin state, remotes, tags,
  // and each worktree with its branch, path and uncommitted count (this session's marked in yellow)
  const refCard = (row: Row) => {
    const p = pointers(row.decor, row.hash, known)
    return (
      <Box key={`ref-card:${row.hash}`} flexDirection="column" marginLeft={2} borderStyle="round" borderColor={C.sel} paddingX={1}>
        {p.locals.map(l => (
          <Text key={`ref:b:${l.name}`}>
            <Text color={C.green}>{`⎇ ${l.name}`}</Text>
            <Text color={C.gray}>{`  ${l.sync}`}</Text>
          </Text>
        ))}
        {p.remotes.map(r => <Text key={`ref:r:${r}`} color={C.red}>{`⌂ ${r}`}</Text>)}
        {p.tags.map(t => <Text key={`ref:t:${t}`} color={C.orange}>{`# ${t}`}</Text>)}
        {p.trees.map(t => (
          <Box key={`ref:w:${t.path}`} flexDirection="column">
            <Text>
              <Text bold color={t.isSelf ? C.glow : C.purple}>{`⑂ ${t.name}`}</Text>
              <Text color={t.branch ? C.green : C.yellow}>{t.branch ? `  ⎇ ${t.branch}` : `  ${t.head.slice(0, 7)} (detached)`}</Text>
              {t.isSelf && <Text color={C.glow}>  이 세션</Text>}
            </Text>
            <Text color={C.gray} wrap="truncate-start">{`  ${t.path}`}</Text>
            <Text color={C.gray}>{`  변경 ${treeStatus[t.path] === undefined ? '…' : treeStatus[t.path] === '?' ? '?' : `${treeStatus[t.path]}개`}`}</Text>
          </Box>
        ))}
      </Box>
    )
  }

  const card = (d: GraphDetail, row: Row) => {
    const short = row.short
    const [title = '', ...rest] = d.body.split('\n')
    const more = rest.join('\n').trim()
    const adds = d.files.reduce((n, f) => n + (Number(f.add) || 0), 0)
    const dels = d.files.reduce((n, f) => n + (Number(f.del) || 0), 0)
    return (
      <Box flexDirection="column" marginLeft={2} borderStyle="round" borderColor={C.sel} paddingX={1}>
        {d.isLoading ? (
          <Text color={C.gray}>불러오는 중…</Text>
        ) : (
          <Box flexDirection="column">
            <Text bold color={C.white}>{title}</Text>
            {more !== '' && <Text color={C.fg}>{more}</Text>}
            <Text color={C.gray}>
              {`파일 ${d.files.length}개 `}
              <Text color={C.green}>{`+${adds}`}</Text> <Text color={C.red}>{`−${dels}`}</Text>
            </Text>
              {d.files.slice(0, MAX_FILES).map((f, i) => {
              const cut = f.path.lastIndexOf('/') + 1
              return fileLine(`f:${d.hash}:${i}`, f.path, cut, [
                <Text color={C.green}>{`+${f.add}`.padStart(5)}</Text>,
                <Text color={C.red}>{` −${f.del}`.padEnd(6)}</Text>,
              ])
            })}
            {d.files.length > MAX_FILES && <Text color={C.gray}>{`… 외 ${d.files.length - MAX_FILES}개`}</Text>}
            <Box>
              {[['explain', '설명', explain], ['review', '리뷰', review], ['compare', 'HEAD 와 비교', compare]].map(([k, label, ask]) => (
                // a gray block so each reads as a button, like the chips
                <Box key={`box:ask:${k}`} marginRight={1} paddingX={1} backgroundColor={C.sel}>
                  <Button key={`ask:${k}`} plain hover={{ color: C.blue }} onPress={() => void say($, (ask as typeof explain)(short))}>
                    {label as string}
                  </Button>
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </Box>
    )
  }

  const changesCard = () => {
    const adds = (files ?? []).reduce((n, f) => n + (Number(f.add) || 0), 0)
    const dels = (files ?? []).reduce((n, f) => n + (Number(f.del) || 0), 0)
    return (
      <Box flexDirection="column" marginLeft={2} borderStyle="round" borderColor={C.sel} paddingX={1}>
        {files === null ? (
          <Text color={C.gray}>불러오는 중…</Text>
        ) : (
          <Box flexDirection="column">
            <Text color={C.gray}>
              {`파일 ${files.length}개 `}
              <Text color={C.green}>{`+${adds}`}</Text> <Text color={C.red}>{`−${dels}`}</Text>
            </Text>
            {files.slice(0, MAX_FILES).map((f, i) =>
              fileLine(`d:${i}`, f.path, f.path.lastIndexOf('/') + 1, [
                f.add === NEW ? (
                  <Text color={C.cyan}>{'new'.padStart(5)}</Text>
                ) : (
                  <Text color={C.green}>{`+${f.add}`.padStart(5)}</Text>
                ),
                <Text color={C.red}>{f.add === NEW ? ''.padEnd(6) : ` −${f.del}`.padEnd(6)}</Text>,
              ]),
            )}
            {files.length > MAX_FILES && <Text color={C.gray}>{`… 외 ${files.length - MAX_FILES}개`}</Text>}
            <Box key="box:ask:commit-message" alignSelf="flex-start" paddingX={1} backgroundColor={C.sel}>
              <Button key="ask:commit-message" plain hover={{ color: C.blue }} onPress={() => void say($, COMMIT_MESSAGE)}>
                커밋 메시지 정리
              </Button>
            </Box>
          </Box>
        )}
      </Box>
    )
  }

  // the top lines (fold button, uncommitted count), and the HEAD row once it scrolled out
  const top = (pin: string) => [
    <Box key={`${pin}bar`}>
      {lanes > FOLDED_LANES && (
        // a hover needs a keyed Box around it to know what the pointer is over
        <Box key={`${pin}lanes-bar`} marginRight={2}>
          <Button key={`${pin}lanes`} plain dimColor hover={{ color: C.blue }} onPress={() => void update($, wide, v => !v)}>
            {isWide ? '◂ 가지 접기' : `▸ 가지 ${lanes}개 모두 보기`}
          </Button>
        </Box>
      )}
      <Box key={`${pin}remote-bar`} marginRight={2}>
        <Button key={`${pin}remote`} plain dimColor={!isWatch} hover={{ color: C.blue }} onPress={() => void toggleWatch($).catch(() => {})}>
          {isWatch ? '원격 확인 끄기' : '원격 확인'}
        </Button>
      </Box>
      <Box key={`${pin}trace-bar`}>
        <Button key={`${pin}trace`} plain dimColor={!isOn} hover={{ color: C.blue }} onPress={() => void update($, isTraced, v => !v)}>
          {isOn ? '경로 강조 끄기' : '경로 강조'}
        </Button>
      </Box>
    </Box>,
    changed > 0 && (
      <Box key={`${pin}dirty-bar`}>
        <Text color={C.yellow}>◌ </Text>
        <Button key={`${pin}dirty`} plain hover={{ color: C.blue }} onPress={() => void toggleChanges($).catch(() => {})}>
          {`커밋 안 한 변경 ${changed}개`}
        </Button>
      </Box>
    ),
    // the card sits in place only: the pinned copy is just the lines
    !pin && changed > 0 && isChangesOpen && changesCard(),
  ]

  const commit = (row: Row, pin: string) => {
    const isOpen = openHash === row.hash
    // off the path to HEAD: graph, chips and subject go gray
    const isOff = kin !== null && !kin.has(row.hash)
    const paint = (segs: Seg[]) => (isOff ? dim(segs) : segs)
    // HEAD's dot is bright yellow everywhere; it pulses (Raster) in the main pane's terminal only,
    // the pinned copy and the other surfaces keep it still (a Raster key would repeat in the copy)
    const split = row.isHead ? splitDot(row.graph) : null
    const isPulsing = !!Raster && !pin
    if (split && isPulsing) startPulse($)
    const graph = split
      ? [
          ...(split.before.length > 0 ? [<Text>{split.before.map(seg)}</Text>] : []),
          Raster && isPulsing ? <Raster key={PULSE_KEY} columns={1} rows={1} cells={FRAMES[phase] ?? ''} /> : <Text color={C.glow}>●</Text>,
          ...(split.after.length > 0 ? [<Text>{split.after.map(seg)}</Text>] : []),
        ]
      : [<Text>{paint(row.graph).map(seg)}</Text>]
    return (
      <Box
        key={`${pin}${row.hash}`}
        backgroundColor={row.isHead || isOpen ? C.sel : undefined}
        hover={row.isHead || isOpen ? undefined : { backgroundColor: C.hover }}
      >
        <Box flexShrink={0}>
          {graph}
        </Box>
        <Box flexGrow={1} flexShrink={1} overflow="hidden">
          {row.isHead && (
            <Box flexShrink={0} marginRight={1}>
              {paint([chip('HEAD', C.blue)]).map(seg)}
            </Box>
          )}
          {paint(row.refs).map((c, i) => (
            // a button on a dark tint of the chip's color; a keyed Box around it gives the hover its anchor
            <Box key={`${pin}box:r:${row.short}:${i}`} flexShrink={0} marginRight={1} paddingX={1} backgroundColor={tint(c.backgroundColor ?? C.gray)}>
              <Button
                key={`${pin}r:${row.short}:${i}`}
                plain
                dimColor={isOff}
                hover={{ color: C.blue }}
                onPress={() => void toggleRefs($, row.hash).catch(() => {})}
              >
                {c.text.trim()}
              </Button>
            </Box>
          ))}
          {made.has(row.hash) && (
            <Box flexShrink={0}>
              <Text color={C.yellow}>✦ </Text>
            </Box>
          )}
          <Text wrap="truncate-end" color={isOff ? C.gray : row.isHead ? C.white : C.fg} bold={row.isHead}>{row.subject}</Text>
        </Box>
        <Box flexShrink={0} marginLeft={1}>
          <Text backgroundColor={personColor(row.author)} color={C.bg}>{` ${row.author.padEnd(AUTHOR_CELLS)} `}</Text>
          <Button
            key={`${pin}c:${row.short}`}
            plain
            dimColor={!isOpen}
            hover={{ color: C.blue }}
            onPress={() => void toggle($, row.hash, row.short).catch(() => {})}
          >
            {` ${row.short}`}
          </Button>
          <Text color={C.gray}>{` ${row.age.padStart(3)}`}</Text>
        </Box>
      </Box>
    )
  }

  // Scrolled down, a copy of the top lines sits over the window's first rows, drawn at
  // the offset the engine scrolled to (a scroll asks for a new drawing), then a ┊ gap.
  // ponytail: rows of an open card above HEAD are not counted, so HEAD may pin a little late
  const offset = scroll.offset
  const above = top('').filter(Boolean).length
  const headAt = rows.findIndex(r => r.isHead)
  const head = rows[headAt]
  const isHeadGone = head !== undefined && offset > above + headAt
  // the gap is a dotted stretch of the leftmost lane, in that lane's color where the window starts
  const under = rows[Math.min(rows.length - 1, Math.max(0, offset - above))]
  const gapColor = under?.graph[0]?.text.startsWith(' ') ? C.gray : under?.graph[0]?.color ?? C.gray

  return (
    <Box flexDirection="column">
      {top('')}
      {rows.map(row =>
        !row.hash ? (
          <Text>{row.graph.map(seg)}</Text>
        ) : (
          <Box flexDirection="column">
            {commit(row, '')}
            {refHash === row.hash && refCard(row)}
            {openHash === row.hash && shown?.hash === row.hash && card(shown, row)}
          </Box>
        ),
      )}
      {offset > 0 && (
        <Box position="absolute" top={offset} left={0} right={0} flexDirection="column" backgroundColor={C.bg}>
          {top('pin:')}
          {isHeadGone && commit(head, 'pin:')}
          <Text color={gapColor}>┊</Text>
        </Box>
      )}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'git-graph', description: 'git 그래프 패널 열기/닫기' })
    // ponytail: 5s poll catches commits made outside Claude too; fs watch if this ever costs
    $.clock.every(5000, () => void refresh($).catch(() => {}))
    await refresh($).catch(() => {})
    rendered = false
    faults = new Set()
    // a pane that waits undrawn (a narrow terminal) is owed no drawing: watch only a placed one
    void $.ui
      .open({ id: PANE, title: 'Git graph', columns: WIDE })
      .then(r => r.isPlaced && expectRender($))
      .catch(() => {})
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    // a Bash call that moved a worktree's HEAD made commits: remember them for the marker
    const before = await heads($)
    const ran = await next(e)
    const outs = await Promise.all(
      moved(before, await heads($)).map(async m => {
        const r = await $.process.run(added(m.before, m.after)).catch(() => undefined)
        return r?.exitCode === 0 ? r.stdout : ''
      }),
    )
    if (outs.some(Boolean)) await update($, mine, prev => outs.reduce(addMine, prev)).catch(() => {})
    void refresh($).catch(() => {})
    return ran
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    watchdog?.cancel()
    stopPulse()
    return closed
  })

  on('command.run', { command: 'git-graph' }, async $ => {
    if ((await $.ui.panes()).some(p => p.id === PANE && p.isPlaced && p.isShown)) {
      await $.ui.close({ id: PANE })
      return { text: 'git 그래프 패널을 닫았어요.' }
    }
    await $.ui.open({ id: PANE, title: 'Git graph', columns: WIDE })
    return { text: 'git 그래프 패널을 열었어요.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    rendered = true
    try {
      return await paint($, e)
    } catch (err) {
      // the desktop's log is out of sight: say what broke in the pane, and once per message in a toast
      const what = `${err instanceof Error ? err.name : 'Error'}: ${err instanceof Error ? err.message : String(err)}`
      const where = `${what} (${e.surface})`
      if (!faults.has(what)) {
        faults.add(what)
        $.ui.toast(`git-graph 를 그리지 못했어요: ${where}`)
      }
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text color={C.red}>git-graph 를 그리지 못했어요</Text>
          <Text color={C.gray}>{where}</Text>
        </Box>
      )
    }
  })
}
