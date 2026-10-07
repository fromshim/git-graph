import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import { GIT, HEAD, STATUS, TOP, TRACKS, TREES, added, show } from '../core/commands.ts'
import { AUTHOR_CELLS, layout } from '../core/layout.ts'
import type { Row } from '../core/layout.ts'
import { addMine } from '../core/mine.ts'
import { track, trees } from '../core/refs.ts'
import { COMMIT_MESSAGE, compare, explain, mention, review } from '../core/prompt.ts'
import { parseShow } from '../core/show.ts'
import { C, chip, personColor } from '../core/theme.ts'
import type { Seg } from '../core/theme.ts'
import type { GraphDetail, GraphLines, GraphRefs } from '../types'

const PANE = 'git-graph'
const lines = atom({ plugin: 'git-graph', key: 'lines' } as const, [])
const note = atom({ plugin: 'git-graph', key: 'note' } as const, '')
const dirty = atom({ plugin: 'git-graph', key: 'dirty' } as const, 0)
const open = atom({ plugin: 'git-graph', key: 'open' } as const, '')
const detail = atom({ plugin: 'git-graph', key: 'detail' } as const, null)
const refs = atom({ plugin: 'git-graph', key: 'refs' } as const, { heads: [], tracks: {}, trees: [] })
const wide = atom({ plugin: 'git-graph', key: 'wide' } as const, false)
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
  await update($, lines, prev => (prev.join('\n') === got.join('\n') ? prev : got))
}

async function head($: EngineInterface) {
  const r = await $.process.run(HEAD).catch(() => undefined)
  return r?.exitCode === 0 ? r.stdout.trim() : ''
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'git-graph', description: 'git 그래프 패널 열기/닫기' })
    // ponytail: 5s poll catches commits made outside Claude too; fs watch if this ever costs
    $.clock.every(5000, () => void refresh($).catch(() => {}))
    await refresh($).catch(() => {})
    void $.ui.open({ id: PANE, title: 'Git graph', columns: WIDE })
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    // a Bash call that moved HEAD made commits: remember them for the marker
    const before = await head($)
    const ran = await next(e)
    const after = await head($)
    if (after && after !== before) {
      const r = await $.process.run(added(before, after)).catch(() => undefined)
      if (r?.exitCode === 0) await update($, mine, prev => addMine(prev, r.stdout)).catch(() => {})
    }
    void refresh($).catch(() => {})
    return ran
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
    const { Box, Text, Button } = $.ui.resolve(e)
    const msg = await read($, note)

    if (msg)
      return (
        <Box height={e.props.scroll.bodyRows} justifyContent="center" alignItems="center">
          <Text color={C.white}>{msg}</Text>
        </Box>
      )

    const isWide = await read($, wide)
    const { rows, lanes } = layout(await read($, lines), Date.now(), await read($, refs), isWide ? Infinity : FOLDED_LANES)
    const changed = await read($, dirty)
    const openHash = await read($, open)
    const shown = await read($, detail)
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

    const card = (d: GraphDetail, short: string) => {
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
                  <Box key={`box:ask:${k}`} marginRight={1}>
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

    // the top lines (fold button, uncommitted count), and the HEAD row once it scrolled out
    const top = (pin: string) => [
      lanes > FOLDED_LANES && (
        // a hover needs a keyed Box around it to know what the pointer is over
        <Box key={`${pin}lanes-bar`}>
          <Button key={`${pin}lanes`} plain dimColor hover={{ color: C.blue }} onPress={() => void update($, wide, v => !v)}>
            {isWide ? '◂ 가지 접기' : `▸ 가지 ${lanes}개 모두 보기`}
          </Button>
        </Box>
      ),
      changed > 0 && (
        <Text>
          <Text color={C.gray}>◌ </Text>
          <Text italic color={C.yellow}>커밋 안 한 변경 {changed}개</Text>
        </Text>
      ),
    ]

    const commit = (row: Row, pin: string) => {
      const isOpen = openHash === row.hash
      return (
        <Box
          key={`${pin}${row.hash}`}
          backgroundColor={row.isHead || isOpen ? C.sel : undefined}
          hover={row.isHead || isOpen ? undefined : { backgroundColor: C.hover }}
        >
          <Box flexShrink={0}>
            <Text>{row.graph.map(seg)}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1} overflow="hidden">
            <Text wrap="truncate-end">
              {(row.isHead ? [chip('HEAD', C.blue), ...row.refs] : row.refs).flatMap(s => [seg(s), ' '])}
              {made.has(row.hash) && <Text color={C.yellow}>✦ </Text>}
              <Text color={row.isHead ? C.white : C.fg} bold={row.isHead}>{row.subject}</Text>
            </Text>
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
    const offset = e.props.scroll.offset
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
              {openHash === row.hash && shown?.hash === row.hash && card(shown, row.short)}
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
  })
}
