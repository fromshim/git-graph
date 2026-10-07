import { expect, test } from 'claude-code/testing'

import { layout } from '../core/layout.ts'
import { age, refChips, track, trees } from '../core/refs.ts'
import { ancestors, dim } from '../core/ancestry.ts'
import { parseChanges } from '../core/changes.ts'
import { COMMIT_MESSAGE, compare, explain, mention, review } from '../core/prompt.ts'
import { MINE_CAP, addMine } from '../core/mine.ts'
import { parseShow } from '../core/show.ts'

const S = '\x1f'
const NOW = 1_800_000_000_000
const T = NOW / 1000 - 7200
// A merges B and C; B and C both grew from D
const log = (hash: string, parents: string, refs: string, author: string, subject: string) =>
  [hash, parents, hash.slice(0, 7), refs, author, String(T), subject].join(S)
const LOG = [
  log('aaaaaaa1', 'bbbbbbb2 ccccccc3', 'HEAD -> main, origin/main, origin/HEAD, tag: v1', 'TJ_iconX', 'Merge it'),
  log('bbbbbbb2', 'ddddddd4', '', 'seungboshim-iconx', 'main work'),
  log('ccccccc3', 'ddddddd4', 'origin/feat/x', 'seungboshim-iconx', 'feature work'),
  log('ddddddd4', '', '', 'TJ_iconX', 'root commit'),
].join('\n')

const PROPS = {
  title: 'Git graph', isFocused: false, bodyColumns: 70, placement: 'dock',
  scroll: { offset: 0, bodyRows: 30 }, view: {},
} as const

test('refs become chips: local+origin merged, remote and tag apart, origin/HEAD dropped', () => {
  const { chips, isHead } = refChips('HEAD -> main, origin/main, origin/HEAD, tag: v1, origin/feat/x')
  expect(isHead).toBe(true)
  expect(chips.map(c => c.text)).toEqual([' ⎇ main = ', ' # v1 ', ' ⌂ origin/feat/x '])
})

test('upstream tracking and worktrees become chips', () => {
  expect([track('[ahead 2, behind 1]'), track('[behind 3]'), track('[gone]'), track('')]).toEqual(['↑2 ↓1', '↓3', '', ''])
  const list = trees('worktree /r/main\nHEAD aaa\nbranch refs/heads/main\n\nworktree /r/wt-a\nHEAD bbb\ndetached\n', '/r/wt-a')
  expect(list).toEqual([{ name: 'main', head: 'aaa', isSelf: false }, { name: 'wt-a', head: 'bbb', isSelf: true }])
  const known = { heads: ['feat', 'docs/x'], tracks: { feat: '↑2' }, trees: list }
  expect(refChips('feat', 'bbb', known).chips.map(c => c.text)).toEqual([' ⑂ wt-a ', ' ⎇ feat ↑2 '])
  // a slash does not make a branch remote: the local heads decide
  expect(refChips('docs/x, upstream/y', '', known).chips.map(c => c.text)).toEqual([' ⎇ docs/x ', ' ⌂ upstream/y '])
  // one worktree alone is just the repo: no chip
  expect(refChips('', 'aaa', { heads: [], tracks: {}, trees: list.slice(0, 1) }).chips).toEqual([])
})

test('layout draws one row per commit, bending forks and merges inside the row; HEAD is the one dot', () => {
  const { rows } = layout(LOG.split('\n'), NOW)
  expect(rows.map(r => r.graph.map(s => s.text).join(''))).toEqual(['●─╮ ', '┿ │ ', '│ ┿ ', '┷─╯ '])
  // the side branch keeps one color from its merge down to where it forked
  const colorAt = (segs: { text: string; color?: string }[], x: number) => {
    let at = 0
    for (const s of segs) if ((at += [...s.text].length) > x) return s.color
  }
  const side = rows.map(r => colorAt(r.graph, 2))
  expect(new Set(side).size).toBe(1)
  expect(side[0]).not.toBe(rows[0]?.graph[0]?.color)
  expect([rows[1]?.short, rows[1]?.author, rows[1]?.age]).toEqual(['bbbbbbb', 'seung', '2h'])
  expect(age(NOW / 1000 - 30, NOW)).toBe('now')
})

test('a merge that is also a fork point bends the fork on its own row above it', () => {
  const { rows } = layout([
    log('ttttttt1', 'mmmmmmm3', '', 'TJ', 'main tip'),
    log('xxxxxxx2', 'mmmmmmm3', '', 'TJ', 'branch off the merge'),
    log('mmmmmmm3', 'ppppppp5 fffffff4', '', 'TJ', 'Merge f'),
    log('fffffff4', 'ppppppp5', '', 'TJ', 'f work'),
    log('ppppppp5', '', '', 'TJ', 'root'),
  ], NOW)
  expect(rows.map(r => r.graph.map(s => s.text).join(''))).toEqual(['┯   ', '│ ┯ ', '├─╯ ', '┿─╮ ', '│ ┿ ', '┷─╯ '])
  expect(rows.map(r => r.hash !== '')).toEqual([true, true, false, true, true, true])
})

test('several forks off one commit bend on one row each, nearest first', () => {
  const { rows } = layout([
    log('ttttttt1', 'mmmmmmm4', '', 'TJ', 'main tip'),
    log('xxxxxxx2', 'mmmmmmm4', '', 'TJ', 'fork one'),
    log('yyyyyyy3', 'mmmmmmm4', '', 'TJ', 'fork two'),
    log('mmmmmmm4', 'ppppppp6 fffffff5', '', 'TJ', 'Merge f'),
    log('fffffff5', 'ppppppp6', '', 'TJ', 'f work'),
    log('ppppppp6', '', '', 'TJ', 'root'),
  ], NOW)
  expect(rows.map(r => r.graph.map(s => s.text).join(''))).toEqual(
    ['┯     ', '│ ┯   ', '│ │ ┯ ', '├─╯ │ ', '├───╯ ', '┿─╮   ', '│ ┿   ', '┷─╯   '],
  )
})

test('lanes past the limit fold into one column', () => {
  const { rows, lanes } = layout([
    log('ttttttt1', 'mmmmmmm4', '', 'TJ', 'main tip'),
    log('xxxxxxx2', 'mmmmmmm4', '', 'TJ', 'fork one'),
    log('yyyyyyy3', 'mmmmmmm4', '', 'TJ', 'fork two'),
    log('mmmmmmm4', 'ppppppp6 fffffff5', '', 'TJ', 'Merge f'),
    log('fffffff5', 'ppppppp6', '', 'TJ', 'f work'),
    log('ppppppp6', '', '', 'TJ', 'root'),
  ], NOW, undefined, 2)
  expect(lanes).toBe(3)
  expect(rows.map(r => r.graph.map(s => s.text).join(''))).toEqual(
    ['┯     ', '│ ┯   ', '│ │ ┯ ', '├─╯ ┆ ', '├───┆ ', '┿─╮   ', '│ ┿   ', '┷─╯   '],
  )
})

test('the pane draws rows, the HEAD chip and the uncommitted count; a hash opens the commit', async ($, on) => {
  on('process.run', async (_, e) => ({
    value: { exitCode: 0, stdout: e.argv[1] === 'status' ? ' M a\n?? b\n' : e.argv[1] === 'show' ? 'Merge it\n\nwhy\n\x1e\n4\t2\tsrc/app/main.ts\n' : LOG, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('command.register', async () => ({ value: { command: 'git-graph' } }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('session.start', async (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'git-graph', surface, component: 'Pane', props: PROPS, requestId: 'git-graph' })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(await ui.find({ key: 'dirty' })).toBeDefined()
    expect((await ui.find({ key: 'dirty' }))?.text).toBe('커밋 안 한 변경 2개')
    expect(texts).toContain(' HEAD ')
    expect(texts).toContain('root commit')
    await ui.press({ key: 'c:aaaaaaa' })
    const opened = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(await ui.find({ type: 'Button', text: 'main.ts' })).toBeDefined()
    expect(opened).toContain('why')
    await ui.press({ key: 'c:aaaaaaa' })
    expect(await ui.find({ type: 'Button', text: 'main.ts' })).toBeUndefined()
    await ui.unmount()
  }
})

test('past three lanes the pane draws the fold button, and it unfolds the graph', async ($, on) => {
  const tips = ['1', '2', '3', '4'].map(n => log(`ttttttt${n}`, 'rrrrrrr9', '', 'TJ', `tip ${n}`))
  const WIDE_LOG = [...tips, log('rrrrrrr9', '', '', 'TJ', 'root')].join('\n')
  on('process.run', async (_, e) => ({
    value: { exitCode: 0, stdout: e.argv[1] === 'log' ? WIDE_LOG : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('command.register', async () => ({ value: { command: 'git-graph' } }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('session.start', async (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'git-graph', surface, component: 'Pane', props: PROPS, requestId: 'git-graph' })
    expect((await ui.find({ key: 'lanes' }))?.text).toBe('▸ 가지 4개 모두 보기')
    await ui.press({ key: 'lanes' })
    expect((await ui.find({ key: 'lanes' }))?.text).toBe('◂ 가지 접기')
    await ui.press({ key: 'lanes' })
    await ui.unmount()
  }
})

test('scrolled down, the top lines and HEAD stay pinned over a ┊ gap', async ($, on) => {
  const many = Array.from({ length: 30 }, (_, i) => {
    const n = String(i).padStart(7, '0')
    const parent = i < 29 ? String(i + 1).padStart(7, '0') + 'p' : ''
    return log(`${n}p`, parent, i === 0 ? 'HEAD -> main' : '', 'TJ', `commit ${i}`)
  })
  on('process.run', async (_, e) => ({
    value: { exitCode: 0, stdout: e.argv[1] === 'log' ? many.join('\n') : e.argv[1] === 'status' ? ' M a\n' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('command.register', async () => ({ value: { command: 'git-graph' } }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('session.start', async (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const at = (offset: number) => ({ ...PROPS, scroll: { offset, bodyRows: 10 } })
  const flat = await $.ui.mount({ plugin: 'git-graph', surface: 'terminal', component: 'Pane', props: at(0), requestId: 'git-graph' })
  expect(await flat.find({ text: '┊' })).toBeUndefined()
  const once = (await flat.findAll({ text: '커밋 안 한 변경 1개' })).length
  await flat.unmount()
  const down = await $.ui.mount({ plugin: 'git-graph', surface: 'terminal', component: 'Pane', props: at(12), requestId: 'git-graph' })
  expect(await down.find({ text: '┊' })).toBeDefined()
  expect(await down.find({ key: 'pin:c:0000000' })).toBeDefined()
  // the uncommitted line shows twice: in place, and pinned
  expect((await down.findAll({ text: '커밋 안 한 변경 1개' })).length).toBe(once * 2)
  await down.unmount()
})

test('outside a repo the pane says so', async ($, on) => {
  on('process.run', async () => ({ value: { exitCode: 128, stdout: '', stderr: 'fatal', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', async () => ({ value: { command: 'git-graph' } }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('session.start', async (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'git-graph', surface: 'terminal', component: 'Pane', props: PROPS, requestId: 'git-graph' })
  expect(await ui.find({ text: 'git 저장소가 아니에요' })).toBeDefined()
})

test('parseShow splits the message from the numstat rows', () => {
  const d = parseShow('abc1234', 'Title line\n\nbody text\n\x1e\n3\t1\tsrc/a.ts\n-\t-\tlogo.png\n')
  expect(d.body).toBe('Title line\n\nbody text')
  expect(d.files).toEqual([{ add: '3', del: '1', path: 'src/a.ts' }, { add: '-', del: '-', path: 'logo.png' }])
})

test('prompt texts and @mentions: a rename mentions its new path', () => {
  expect([explain('abc1234'), review('abc1234'), compare('abc1234')]).toEqual([
    '커밋 abc1234 을 설명해줘', '커밋 abc1234 을 리뷰해줘', '커밋 abc1234 부터 HEAD 까지 바뀐 점을 정리해줘',
  ])
  expect(COMMIT_MESSAGE).toBe('지금 변경을 커밋 메시지로 정리해줘')
  expect([mention('src/a.ts'), mention('src/{old => new}/a.ts'), mention('a.ts => b.ts'), mention('{ => lib}/a.ts')]).toEqual([
    '@src/a.ts ', '@src/new/a.ts ', '@b.ts ', '@lib/a.ts ',
  ])
})

test('an open card hands the commit to Claude: buttons fill the prompt box, a file inserts @path, a refusal toasts', async ($, on) => {
  const fills: { text: string; mode: string }[] = []
  const toasts: string[] = []
  let isFilled = true
  on('process.run', async (_, e) => ({
    value: { exitCode: 0, stdout: e.argv[1] === 'show' ? 'Merge it\n\nwhy\n\x1e\n4\t2\tsrc/app/main.ts\n' : e.argv[1] === 'log' ? LOG : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('prompt.fill', async (_, e) => {
    fills.push({ text: e.text, mode: e.mode })
    return { isFilled }
  })
  on('ui.toast', async (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('command.register', async () => ({ value: { command: 'git-graph' } }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('session.start', async (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'git-graph', surface: 'terminal', component: 'Pane', props: PROPS, requestId: 'git-graph' })
  expect(await ui.find({ key: 'ask:review' })).toBeUndefined()
  await ui.press({ key: 'c:aaaaaaa' })
  await ui.press({ key: 'ask:explain' })
  await ui.press({ key: 'ask:review' })
  await ui.press({ key: 'ask:compare' })
  await ui.press({ key: 'f:aaaaaaa1:0' })
  expect(fills).toEqual([
    { text: '커밋 aaaaaaa 을 설명해줘', mode: 'replace' },
    { text: '커밋 aaaaaaa 을 리뷰해줘', mode: 'replace' },
    { text: '커밋 aaaaaaa 부터 HEAD 까지 바뀐 점을 정리해줘', mode: 'replace' },
    { text: '@src/app/main.ts ', mode: 'insert' },
  ])
  expect(toasts).toEqual([])
  isFilled = false
  await ui.press({ key: 'ask:review' })
  expect(toasts).toEqual(['프롬프트 입력창에 넣지 못했어요'])
  await ui.unmount()
})

test('addMine keeps the newest first, drops repeats and stays capped', () => {
  expect(addMine(['b'], 'a\n\nb\n')).toEqual(['a', 'b'])
  expect(addMine(['b'], '')).toEqual(['b'])
  expect(addMine([], Array.from({ length: MINE_CAP + 5 }, (_, i) => `h${i}`).join('\n'))).toHaveLength(MINE_CAP)
})

test('a Bash call that moves HEAD marks the new commits with ✦; one that does not marks nothing', async ($, on) => {
  const calls: string[][] = []
  let heads = ['old', 'aaaaaaa1']
  on('process.run', async (_, e) => {
    calls.push([...e.argv])
    const out = e.argv[2] === 'HEAD' ? (heads.shift() ?? 'aaaaaaa1') : e.argv[1] === 'rev-list' ? 'bbbbbbb2\n' : e.argv[1] === 'log' ? LOG : ''
    return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', async () => ({ result: {} }))
  on('command.register', async () => ({ value: { command: 'git-graph' } }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('session.start', async (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const marks = async () => {
    const ui = await $.ui.mount({ plugin: 'git-graph', surface: 'terminal', component: 'Pane', props: PROPS, requestId: 'git-graph' })
    const n = (await ui.findAll({ type: 'Text', text: '✦' })).filter(t => t.text === '✦ ').length
    await ui.unmount()
    return n
  }
  expect(await marks()).toBe(0)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
  expect(calls.find(a => a[1] === 'rev-list')).toEqual(['git', 'rev-list', '-n', '50', 'old..aaaaaaa1'])
  expect(await marks()).toBe(1)
  // HEAD unchanged: no rev-list
  heads = ['aaaaaaa1', 'aaaaaaa1']
  calls.length = 0
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(calls.some(a => a[1] === 'rev-list')).toBe(false)
})

test('parseChanges lists tracked counts, then untracked files as new', () => {
  expect(parseChanges('3\t1\tsrc/a.ts\n-\t-\tlogo.png\n', ' M src/a.ts\n?? b.txt\n?? "c d.txt"\nA  x\n')).toEqual([
    { add: '3', del: '1', path: 'src/a.ts' },
    { add: '-', del: '-', path: 'logo.png' },
    { add: 'new', del: '', path: 'b.txt' },
    { add: 'new', del: '', path: 'c d.txt' },
  ])
  expect(parseChanges('', '')).toEqual([])
})

test('the uncommitted line opens a card of changed files; a file inserts @path, the button asks for a message', async ($, on) => {
  const fills: { text: string; mode: string }[] = []
  on('process.run', async (_, e) => ({
    value: {
      exitCode: 0,
      stdout: e.argv[1] === 'status' ? ' M src/a.ts\n?? b.txt\n' : e.argv[1] === 'diff' ? '3\t1\tsrc/a.ts\n' : e.argv[1] === 'log' ? LOG : '',
      stderr: '', isStdoutTruncated: false, isStderrTruncated: false,
    },
  }))
  on('prompt.fill', async (_, e) => {
    fills.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })
  on('command.register', async () => ({ value: { command: 'git-graph' } }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('session.start', async (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'git-graph', surface: 'terminal', component: 'Pane', props: PROPS, requestId: 'git-graph' })
  expect(await ui.find({ key: 'ask:commit-message' })).toBeUndefined()
  await ui.press({ key: 'dirty' })
  expect((await ui.find({ key: 'd:0' }))?.text).toBe('a.ts')
  expect((await ui.find({ key: 'd:1' }))?.text).toBe('b.txt')
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toContain('  new')
  await ui.press({ key: 'd:0' })
  await ui.press({ key: 'ask:commit-message' })
  expect(fills).toEqual([{ text: '@src/a.ts ', mode: 'insert' }, { text: '지금 변경을 커밋 메시지로 정리해줘', mode: 'replace' }])
  await ui.press({ key: 'dirty' })
  expect(await ui.find({ key: 'd:0' })).toBeUndefined()
  await ui.unmount()
})

// HEAD sits on h1; x1 is a side tip off the same parent p
const TRACE_LOG = [
  log('hhhhhhh1', 'ppppppp9', 'HEAD -> main', 'TJ', 'on the path'),
  log('xxxxxxx2', 'ppppppp9', 'feat', 'TJ', 'off the path'),
  log('ppppppp9', '', '', 'TJ', 'root'),
]

test('ancestors walks parents from HEAD; none without HEAD; dim grays colors but not blanks', () => {
  expect([...(ancestors(TRACE_LOG) ?? [])].sort()).toEqual(['hhhhhhh1', 'ppppppp9'])
  expect(ancestors(TRACE_LOG.slice(1))).toBeNull()
  expect(dim([{ text: '┿', color: '#fff' }, { text: ' ' }, { text: ' x ', backgroundColor: '#f00', color: '#000', bold: true }])).toEqual([
    { text: '┿', color: '#5c6370', backgroundColor: undefined },
    { text: ' ', color: undefined, backgroundColor: undefined },
    { text: ' x ', backgroundColor: '#5c6370', color: '#000', bold: true },
  ])
})

test('the 경로 강조 toggle grays rows off the HEAD path, in the top bar and in its pinned copy', async ($, on) => {
  on('process.run', async (_, e) => ({
    value: { exitCode: 0, stdout: e.argv[1] === 'log' ? TRACE_LOG.join('\n') : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('command.register', async () => ({ value: { command: 'git-graph' } }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('session.start', async (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const color = async (ui: { findAll: (q: { type: string; text: string }) => Promise<{ text: string; props: Record<string, unknown> }[]> }, subject: string) => (await ui.findAll({ type: 'Text', text: subject })).find(t => t.text === subject)?.props.color
  const ui = await $.ui.mount({ plugin: 'git-graph', surface: 'terminal', component: 'Pane', props: PROPS, requestId: 'git-graph' })
  expect((await ui.find({ key: 'trace' }))?.text).toBe('경로 강조')
  expect(await color(ui, 'off the path')).toBe('#abb2bf')
  await ui.press({ key: 'trace' })
  expect((await ui.find({ key: 'trace' }))?.text).toBe('경로 강조 끄기')
  expect(await color(ui, 'off the path')).toBe('#5c6370')
  expect(await color(ui, 'on the path')).not.toBe('#5c6370')
  expect(await color(ui, 'root')).not.toBe('#5c6370')
  await ui.press({ key: 'trace' })
  expect(await color(ui, 'off the path')).toBe('#abb2bf')
  await ui.unmount()
  const down = await $.ui.mount({ plugin: 'git-graph', surface: 'terminal', component: 'Pane', props: { ...PROPS, scroll: { offset: 5, bodyRows: 3 } }, requestId: 'git-graph' })
  expect(await down.find({ key: 'pin:trace' })).toBeDefined()
  await down.unmount()
})
