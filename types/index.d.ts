export type GraphLines = string[]
export type GraphFile = { add: string; del: string; path: string }
export type GraphDetail = { hash: string; body: string; files: GraphFile[]; isLoading: boolean }
export type GraphTree = { name: string; head: string; isSelf: boolean }
export type GraphRefs = { heads: string[]; tracks: Record<string, string>; trees: GraphTree[] }

declare module 'claude-code' {
  interface PluginState {
    'git-graph': {
      lines: GraphLines
      note: string
      dirty: number
      open: string
      detail: GraphDetail | null
      refs: GraphRefs
      wide: boolean
    }
  }
}
