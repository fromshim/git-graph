// git argv arrays and the field separator of the log format; running them stays with the caller

// one commit per line, fields split by \x1f: hash, parents, short hash, refs, author, unix time, subject
export const SEP = '\x1f'
export const GIT = ['git', 'log', '--all', '--date-order', '--color=never', '-n', '150', `--format=%H${SEP}%P${SEP}%h${SEP}%D${SEP}%an${SEP}%ct${SEP}%s`]
export const STATUS = ['git', 'status', '--porcelain']
export const TRACKS = ['git', 'for-each-ref', '--format=%(refname:short)%09%(upstream:track)', 'refs/heads']
export const TREES = ['git', 'worktree', 'list', '--porcelain']
export const TOP = ['git', 'rev-parse', '--show-toplevel']
// -m --first-parent: a merge lists what it brought onto its first parent
export const show = (hash: string) => ['git', 'show', '-m', '--first-parent', '--numstat', '--format=%B\x1e', hash]
