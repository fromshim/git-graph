import { expect, mock, test } from 'claude-code/testing'

import { layout } from '../core/layout.ts'
import { grown } from '../core/remote.ts'
import { age, pointers, refChips, track, trees } from '../core/refs.ts'
import { ancestors, dim } from '../core/ancestry.ts'
import { parseChanges } from '../core/changes.ts'
import { COMMIT_MESSAGE, compare, explain, mention, review } from '../core/prompt.ts'
import { MINE_CAP, addMine, moved } from '../core/mine.ts'
import { parseShow } from '../core/show.ts'
import { C, tint } from '../core/theme.ts'
import { breath, dotCells, splitDot } from '../core/pulse.ts'

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
  expect(list).toEqual([{ name: 'main', path: '/r/main', head: 'aaa', branch: 'main', isSelf: false }, { name: 'wt-a', path: '/r/wt-a', head: 'bbb', branch: '', isSelf: true }])
  const known = { heads: ['feat', 'docs/x'], tracks: { feat: '↑2' }, trees: list }
  expect(refChips('feat', 'bbb', known).chips.map(c => c.text)).toEqual([' ⑂ wt-a ', ' ⎇ feat ↑2 '])
  // this session's own worktree is the yellow glow, the others purple
  const bg = (hash: string) => refChips('', hash, known).chips.map(c => c.backgroundColor)
  expect([bg('bbb'), bg('aaa')]).toEqual([[C.glow], [C.purple]])
  // past three worktrees on one commit: the self one, then one ×N chip
  const many = (n: number, self: number) =>
    ({ heads: [], tracks: {}, trees: Array.from({ length: n }, (_, i) => ({ name: `w${i}`, path: `/r/w${i}`, head: 'ccc', branch: '', isSelf: i === self })) })
  const texts = (n: number, self: number) => refChips('', 'ccc', many(n, self)).chips.map(c => c.text)
  expect(texts(3, 1)).toEqual([' ⑂ w0 ', ' ⑂ w1 ', ' ⑂ w2 '])
  expect(texts(5, 3)).toEqual([' ⑂ w3 ', ' ⑂ ×4 '])
  expect(texts(5, -1)).toEqual([' ⑂ ×5 '])
  expect(refChips('', 'ccc', many(5, -1)).chips.map(c => c.backgroundColor)).toEqual([C.purple])
  // a slash does not make a branch remote: the local heads decide
  expect(refChips('docs/x, upstream/y', '', known).chips.map(c => c.text)).toEqual([' ⎇ docs/x ', ' ⌂ upstream/y '])
  // one worktree alone is just the repo: no chip
  expect(refChips('', 'aaa', { heads: [], tracks: {}, trees: list.slice(0, 1) }).chips).toEqual([])
})

test('pointers list what is on one commit: branches with their origin state, remotes, tags, worktrees', () => {
  const tree = (name: string, isSelf: boolean) => ({ name, path: `/r/${name}`, head: 'aaa', branch: '', isSelf })
  const known = { heads: ['main', 'feat', 'lone'], tracks: { feat: '↑1 ↓2' }, trees: [tree('main', false), tree('wt', true)] }
  expect(pointers('HEAD -> main, origin/main, origin/HEAD, feat, lone, origin/x, tag: v1', 'aaa', known)).toEqual({
    locals: [{ name: 'main', sync: '= origin' }, { name: 'feat', sync: '↑1 ↓2' }, { name: 'lone', sync: 'no upstream' }],
    remotes: ['origin/x'],
    tags: ['v1'],
    trees: known.trees,
  })
  expect(pointers('', 'zzz', known).trees).toEqual([])
})

test('tint mixes a color a little into the pane background, so a light label stays readable on it', () => {
  expect(tint(C.green)).toBe('#475647')
  expect(tint(C.green, 0)).toBe(C.bg)
  expect(tint(C.green, 1)).toBe(C.green)
  // every chip color stays dark: a light label keeps its contrast (sum of channels well under half of white's)
  for (const c of [C.green, C.red, C.orange, C.purple, C.glow, C.gray]) {
    const n = parseInt(tint(c).slice(1), 16)
    expect((n >> 16) + ((n >> 8) & 255) + (n & 255)).toBeLessThan(330)
  }
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

test('a ref chip is a tinted button: it opens a list under its row (one at a time) with each ref and worktree; the commit card no longer lists them', async ($, on) => {
  const clock = mock.clock(on)
  const statusCalls: string[] = []
  const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', async (_, e) => {
    if (e.argv[1] === '-C') {
      statusCalls.push(String(e.argv[2]))
      return e.argv[2] === '/repo' ? out(' M a\n?? b\n') : out('', 128)
    }
    if (e.argv[1] === 'worktree') return out('worktree /repo\nHEAD aaaaaaa1\nbranch refs/heads/main\n\nworktree /repo/.wt/x\nHEAD bbbbbbb2\ndetached\n')
    if (e.argv[1] === 'rev-parse') return out('/repo\n')
    if (e.argv[1] === 'for-each-ref') return out('main\t\n')
    if (e.argv[1] === 'log') return out(LOG)
    if (e.argv[1] === 'show') return out('Merge it\n\nwhy\n\x1e\n4\t2\tsrc/app/main.ts\n')
    return out('')
  })
  on('command.register', async () => ({ value: { command: 'git-graph' } }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('session.start', async (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    statusCalls.length = 0
    const ui = await $.ui.mount({ plugin: 'git-graph', surface, component: 'Pane', props: PROPS, requestId: 'git-graph' })
    const shown = async () => (await ui.findAll({ type: 'Text' })).map(t => t.text)
    // no worktree toggle in the top bar any more
    expect(await ui.find({ key: 'trees' })).toBeUndefined()
    // the chips: this session's worktree, the branch with origin state, the tag; each on a tinted Box
    expect((await ui.find({ key: 'r:aaaaaaa:0' }))?.text).toBe('⑂ repo')
    expect((await ui.find({ key: 'r:aaaaaaa:1' }))?.text).toBe('⎇ main =')
    expect((await ui.find({ key: 'r:aaaaaaa:2' }))?.text).toBe('# v1')
    expect((await ui.find({ key: 'box:r:aaaaaaa:1' }))?.props.backgroundColor).toBe(tint(C.green))
    expect((await ui.find({ key: 'box:r:aaaaaaa:0' }))?.props.backgroundColor).toBe(tint(C.glow))
    expect(await ui.find({ key: 'ref-card:aaaaaaa1' })).toBeUndefined()
    // the HEAD chip stays a filled Text, not a button
    expect(await shown()).toContain(' HEAD ')
    // the commit card has no pointer section now
    await ui.press({ key: 'c:aaaaaaa' })
    expect(await ui.find({ key: 'ref:b:main' })).toBeUndefined()
    expect(await shown()).not.toContain('  = origin')
    await ui.press({ key: 'c:aaaaaaa' })
    // a chip press opens the list: branch with origin state, tag, the worktree on it marked as this session's
    await ui.press({ key: 'r:aaaaaaa:1' })
    expect(await ui.find({ key: 'ref-card:aaaaaaa1' })).toBeDefined()
    expect(await shown()).toEqual(expect.arrayContaining(['⎇ main', '  = origin', '# v1', '⑂ repo', '  ⎇ main', '  /repo', '  이 세션', '  변경 2개']))
    expect((await ui.findAll({ type: 'Text', text: '이 세션' })).find(t => t.text === '  이 세션')?.props.color).toBe(C.glow)
    // another row's chip moves it
    await ui.press({ key: 'r:bbbbbbb:0' })
    expect(await ui.find({ key: 'ref-card:aaaaaaa1' })).toBeUndefined()
    expect(await shown()).toEqual(expect.arrayContaining(['⑂ x', '  bbbbbbb (detached)', '  /repo/.wt/x', '  변경 ?']))
    // while open it follows the 5s refresh
    const before = statusCalls.length
    await clock.advance(5000)
    expect(statusCalls.length).toBeGreaterThan(before)
    // the same chip again closes it
    await ui.press({ key: 'r:bbbbbbb:0' })
    expect(await ui.find({ key: 'ref-card:bbbbbbb2' })).toBeUndefined()
    await ui.unmount()
  }
  // scrolled: the pinned HEAD row has its own chip buttons, and the list stays in the main pane only
  const down = await $.ui.mount({ plugin: 'git-graph', surface: 'terminal', component: 'Pane', props: { ...PROPS, scroll: { offset: 5, bodyRows: 3 } }, requestId: 'git-graph' })
  await down.press({ key: 'pin:r:aaaaaaa:1' })
  expect((await down.findAll({ key: 'ref-card:aaaaaaa1' })).length).toBe(1)
  await down.press({ key: 'r:aaaaaaa:1' })
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

test('a pane the desktop draws with no scroll window still draws (it scrolls itself)', async ($, on) => {
  on('process.run', async (_, e) => ({
    value: { exitCode: 0, stdout: e.argv[1] === 'log' ? LOG : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('command.register', async () => ({ value: { command: 'git-graph' } }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('session.start', async (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  const { scroll: _, ...bare } = PROPS
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'git-graph', surface, component: 'Pane', props: bare as unknown as typeof PROPS, requestId: 'git-graph' })
    expect(await ui.find({ type: 'Text', text: 'root commit' })).toBeDefined()
    await ui.unmount()
  }
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

const WT = (...heads: string[]) => heads.map((h, i) => `worktree /r/w${i}\nHEAD ${h}\nbranch refs/heads/b${i}\n`).join('\n')

test('moved lists the worktrees whose HEAD changed, by path; added, removed and unborn are handled', () => {
  const t = (path: string, head: string) => ({ name: path, path, head, branch: '', isSelf: false })
  expect(moved([t('/a', '1'), t('/b', '2')], [t('/a', '1'), t('/b', '3')])).toEqual([{ before: '2', after: '3' }])
  expect(moved([t('/a', '1'), t('/b', '2')], [t('/a', '4'), t('/b', '5')])).toEqual([{ before: '1', after: '4' }, { before: '2', after: '5' }])
  expect(moved([t('/a', '1')], [t('/a', '1'), t('/new', '9')])).toEqual([])
  expect(moved([t('/a', '1'), t('/gone', '2')], [t('/a', '1')])).toEqual([])
  expect(moved([t('/a', '0000000')], [t('/a', '7')])).toEqual([{ before: '', after: '7' }])
})

test('a Bash call that moves any worktree HEAD marks the new commits with ✦; one that does not marks nothing', async ($, on) => {
  const calls: string[][] = []
  let snaps: string[] = []
  on('process.run', async (_, e) => {
    calls.push([...e.argv])
    const out = e.argv[1] === 'worktree' ? (snaps.shift() ?? '') : e.argv[1] === 'rev-list' ? (e.argv[4]?.startsWith('a01d') ? 'bbbbbbb2\n' : 'ccccccc3\n') : e.argv[1] === 'log' ? LOG : ''
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
  snaps = [WT('a01d', '5b01'), WT('aaaaaaa1', '5b02')]
  expect(await marks()).toBe(0)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
  expect(calls.filter(a => a[1] === 'rev-list')).toEqual([
    ['git', 'rev-list', '-n', '50', 'a01d..aaaaaaa1'],
    ['git', 'rev-list', '-n', '50', '5b01..5b02'],
  ])
  // bbbbbbb2 (first worktree) and ccccccc3 (second) both carry the mark
  expect(await marks()).toBe(2)
  // no HEAD moved: no rev-list
  snaps = [WT('aaaaaaa1', '5b02'), WT('aaaaaaa1', '5b02')]
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
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'git-graph', surface, component: 'Pane', props: PROPS, requestId: 'git-graph' })
    expect(await ui.find({ key: 'ask:commit-message' })).toBeUndefined()
    await ui.press({ key: 'dirty' })
    expect((await ui.find({ key: 'd:0' }))?.text).toBe('a.ts')
    expect((await ui.find({ key: 'd:1' }))?.text).toBe('b.txt')
    expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toContain('  new')
    await ui.press({ key: 'd:0' })
    await ui.press({ key: 'ask:commit-message' })
    expect(fills.splice(0)).toEqual([{ text: '@src/a.ts ', mode: 'insert' }, { text: '지금 변경을 커밋 메시지로 정리해줘', mode: 'replace' }])
    await ui.press({ key: 'dirty' })
    expect(await ui.find({ key: 'd:0' })).toBeUndefined()
    await ui.unmount()
  }
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
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'git-graph', surface, component: 'Pane', props: PROPS, requestId: 'git-graph' })
    expect((await ui.find({ key: 'trace' }))?.text).toBe('경로 강조')
    expect(await color(ui, 'off the path')).toBe('#abb2bf')
    expect((await ui.find({ key: 'box:r:xxxxxxx:0' }))?.props.backgroundColor).toBe(tint(C.green))
    await ui.press({ key: 'trace' })
    expect((await ui.find({ key: 'trace' }))?.text).toBe('경로 강조 끄기')
    // an off-path chip goes to a gray tint, an on-path one keeps its own
    expect((await ui.find({ key: 'box:r:xxxxxxx:0' }))?.props.backgroundColor).toBe(tint(C.gray))
    expect((await ui.find({ key: 'box:r:hhhhhhh:0' }))?.props.backgroundColor).toBe(tint(C.green))
    expect(await color(ui, 'off the path')).toBe('#5c6370')
    expect(await color(ui, 'on the path')).not.toBe('#5c6370')
    expect(await color(ui, 'root')).not.toBe('#5c6370')
    await ui.press({ key: 'trace' })
    expect(await color(ui, 'off the path')).toBe('#abb2bf')
    await ui.unmount()
    const down = await $.ui.mount({ plugin: 'git-graph', surface, component: 'Pane', props: { ...PROPS, scroll: { offset: 5, bodyRows: 3 } }, requestId: 'git-graph' })
    expect(await down.find({ key: 'pin:trace' })).toBeDefined()
    expect(await down.find({ key: 'pin:remote' })).toBeDefined()
    await down.unmount()
  }
})

test('grown names the branches that fell further behind, by how much', () => {
  expect(grown({ main: '↓1', dev: '↑1' }, { main: '↑1 ↓3', dev: '↑1', feat: '↓2' })).toEqual(['main ↓2', 'feat ↓2'])
  expect(grown({ main: '↓3' }, { main: '↓1' })).toEqual([])
  expect(grown({}, {})).toEqual([])
})

test('원격 확인 fetches without prompts, toasts new commits once, one toast per failure streak, and stops when off', async ($, on) => {
  const clock = mock.clock(on)
  const toasts: string[] = []
  const fetches: Record<string, string>[] = []
  let isDown = false
  let fetched = false
  on('process.run', async (_, e) => {
    if (e.argv[1] === 'fetch') {
      fetches.push({ ...e.init?.env })
      fetched = !isDown
      return { value: { exitCode: isDown ? 128 : 0, stdout: '', stderr: isDown ? 'no network' : '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const out = e.argv[1] === 'for-each-ref' ? `main\t[behind ${fetched ? 3 : 1}]\n` : e.argv[1] === 'log' ? LOG : ''
    return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
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
  expect((await ui.find({ key: 'remote' }))?.text).toBe('원격 확인')
  await clock.advance(120_000)
  expect(fetches).toHaveLength(0)
  await ui.press({ key: 'remote' })
  expect((await ui.find({ key: 'remote' }))?.text).toBe('원격 확인 끄기')
  expect(fetches).toEqual([{ GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' }])
  expect(toasts).toEqual(['origin 에 새 커밋: main ↓2'])
  // nothing grew on the next round: no toast
  await clock.advance(60_000)
  expect(fetches).toHaveLength(2)
  expect(toasts).toHaveLength(1)
  // a failing fetch: one toast for the whole streak
  isDown = true
  await clock.advance(60_000)
  await clock.advance(60_000)
  expect(fetches).toHaveLength(4)
  expect(toasts).toHaveLength(2)
  expect(toasts[1]).toContain('git fetch')
  // off: the timer stops
  await ui.press({ key: 'remote' })
  await clock.advance(180_000)
  expect(fetches).toHaveLength(4)
  await ui.unmount()
})

test('the HEAD pulse: 48 frames glow between bright yellow and a partial fade, encode as one ● cell, and the dot splits out of a graph row', () => {
  const fgs = breath()
  expect(fgs).toHaveLength(48)
  // starts at the trough, peaks mid-cycle at the full glow, never goes past it
  expect(fgs[0]).toBe(Math.min(...fgs))
  expect(fgs[24]).toBe(0xffd866)
  expect(Math.max(...fgs)).toBe(0xffd866)
  // it never switches off: even the trough keeps most of the yellow (red channel >= 0xb0) and stays warm (red over blue)
  expect((fgs[0] ?? 0) >> 16).toBeGreaterThanOrEqual(0xb0)
  expect(((fgs[0] ?? 0) >> 16) - ((fgs[0] ?? 0) & 255)).toBeGreaterThan(0x40)
  // sine ease: it moves least beside the trough and the peak, most halfway between
  const lum = (n: number) => (n >> 16) + ((n >> 8) & 255) + (n & 255)
  const steps = fgs.map((f, i) => Math.abs(lum(fgs[(i + 1) % 48] ?? 0) - lum(f)))
  expect(steps[0]).toBeLessThan((steps[11] ?? 0) / 4)
  expect(steps[23]).toBeLessThan((steps[11] ?? 0) / 4)
  // 0x25cf, 0x61afef, 0x3e4451 as little-endian u32, base64
  expect(dotCells(0x61afef)).toBe('zyUAAO+vYQBRRD4A')
  const red = { text: '●─', color: '#f00' }
  expect(splitDot([{ text: '│ ' }, { text: '┿●─╮', color: '#0f0' }, { text: ' ' }])).toEqual({
    before: [{ text: '│ ' }, { text: '┿', color: '#0f0' }],
    after: [{ text: '─╮', color: '#0f0' }, { text: ' ' }],
  })
  expect(splitDot([red])).toEqual({ before: [], after: [{ text: '─', color: '#f00' }] })
  expect(splitDot([{ text: '┿ ' }])).toBeNull()
})

test('HEAD pulses as a Raster on the terminal and stays a still yellow ● elsewhere; a timer blits frames until blit is denied', async ($, on) => {
  const clock = mock.clock(on)
  const blits: { requestId: string; key: string; cells?: string }[] = []
  let isMounted = true
  on('ui.blit', async (_, e) => {
    blits.push({ requestId: e.requestId, key: e.key, cells: 'cells' in e ? e.cells : undefined })
    return { value: isMounted ? {} : { deny: 'not mounted' } }
  })
  on('process.run', async (_, e) => ({
    value: { exitCode: 0, stdout: e.argv[1] === 'log' ? LOG : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('command.register', async () => ({ value: { command: 'git-graph' } }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('session.start', async (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  // desktop: no Raster, the ● stays in the graph text
  const flat = await $.ui.mount({ plugin: 'git-graph', surface: 'desktop', component: 'Pane', props: PROPS, requestId: 'git-graph' })
  expect(await flat.find({ type: 'Raster' })).toBeUndefined()
  expect((await flat.find({ type: 'Text', text: '●' }))?.props.color).toBe(C.glow)
  await flat.unmount()
  await clock.advance(1000)
  expect(blits).toHaveLength(0)
  // terminal: one 1x1 Raster, keyed, and no ● left in the text
  const ui = await $.ui.mount({ plugin: 'git-graph', surface: 'terminal', component: 'Pane', props: PROPS, requestId: 'git-graph' })
  const dot = await ui.find({ type: 'Raster', key: 'pulse' })
  expect(dot?.props).toMatchObject({ columns: 1, rows: 1 })
  expect(await ui.find({ type: 'Text', text: '●' })).toBeUndefined()
  // a second drawing starts no second timer
  await ui.press({ key: 'trace' })
  await ui.press({ key: 'trace' })
  await clock.advance(50 * 48)
  expect(blits).toHaveLength(48)
  expect(blits.every(b => b.requestId === 'git-graph' && b.key === 'pulse')).toBe(true)
  expect(new Set(blits.map(b => b.cells)).size).toBe(new Set(breath()).size)
  // denied: it gives up after a few misses and blits no more
  isMounted = false
  await clock.advance(50 * 10)
  const stopped = blits.length
  expect(stopped).toBe(48 + 5)
  await clock.advance(50 * 10)
  expect(blits).toHaveLength(stopped)
  await ui.unmount()
})

const PANES = [{ id: 'git-graph', title: 'Git graph', isShown: true, isFocused: false, isPlaced: true }]

test('a drawing that throws shows the error in the pane and toasts it once per message, on terminal and desktop', async ($, on) => {
  const toasts: string[] = []
  on('process.run', async (_, e) => ({
    value: { exitCode: 0, stdout: e.argv[1] === 'log' ? LOG : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  // a Button that cannot be made: the drawing throws
  on('ui.resolve', async (_, e, next) => {
    const els = await next(e)
    return { ...els, Button: () => { throw new TypeError('no button') } } as never
  })
  on('ui.toast', async (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('command.register', async () => ({ value: { command: 'git-graph' } }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('session.start', async (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'git-graph', surface, component: 'Pane', props: PROPS, requestId: 'git-graph' })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(texts).toEqual(['git-graph 를 그리지 못했어요', `HooksError: no button (${surface})`])
    await ui.unmount()
  }
  // the same message toasts once, even across two drawings
  expect(toasts).toEqual(['git-graph 를 그리지 못했어요: HooksError: no button (terminal)'])
})

test('no drawing request within 5s toasts once; a drawing, or a pane left undrawn, toasts nothing', async ($, on) => {
  const clock = mock.clock(on)
  const toasts: string[] = []
  let isPlaced = true
  on('process.run', async (_, e) => ({
    value: { exitCode: 0, stdout: e.argv[1] === 'log' ? LOG : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('ui.toast', async (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.panes', async () => ({ value: PANES }))
  on('command.register', async () => ({ value: { command: 'git-graph' } }))
  on('ui.open', async () => ({ value: isPlaced ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'narrow' } }))
  on('session.start', async (_, e) => ({ cwd: e.cwd }))
  // a pane that is drawn: quiet
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'git-graph', surface: 'terminal', component: 'Pane', props: PROPS, requestId: 'git-graph' })
  await clock.advance(20_000)
  expect(toasts).toEqual([])
  await ui.unmount()
  // placed but never asked to draw
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await clock.advance(4_000)
  expect(toasts).toEqual([])
  await clock.advance(2_000)
  expect(toasts).toEqual(['git-graph: 패널 그리기 요청을 받지 못했어요 (표시 예, 배치 예)'])
  await clock.advance(20_000)
  expect(toasts).toHaveLength(1)
  // waiting undrawn on a narrow terminal is normal
  isPlaced = false
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(20_000)
  expect(toasts).toHaveLength(1)
})
