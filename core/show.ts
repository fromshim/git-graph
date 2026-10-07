import type { GraphDetail, GraphFile } from '../types'

// `git show --numstat --format=%B\x1e`: the message, the record separator, then add\tdel\tpath per file
export function parseShow(hash: string, out: string): GraphDetail {
  const [body = '', stat = ''] = out.split('\x1e')
  const files: GraphFile[] = []
  for (const l of stat.split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(l)
    if (m) files.push({ add: m[1] ?? '-', del: m[2] ?? '-', path: m[3] ?? '' })
  }
  return { hash, body: body.trim(), files, isLoading: false }
}
