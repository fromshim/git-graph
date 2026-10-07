// `↑2 ↓3` (core/refs track) -> 3
const behind = (t: string | undefined) => Number(/↓(\d+)/.exec(t ?? '')?.[1] ?? 0)

// branches whose behind count grew between two tracks maps, as "main ↓2" (the growth); none when nothing grew
export function grown(before: Record<string, string>, after: Record<string, string>): string[] {
  return Object.entries(after).flatMap(([name, t]) => {
    const n = behind(t) - behind(before[name])
    return n > 0 ? [`${name} ↓${n}`] : []
  })
}
