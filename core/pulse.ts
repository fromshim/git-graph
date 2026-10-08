import { C, mix, rgb } from './theme.ts'
import type { Seg } from './theme.ts'

export const DOT = '●'
// one cycle is 48 frames x 50ms = 2.4s
export const PULSE_STEPS = 48
export const PULSE_MS = 50
// how far the dimmest frame leans toward the row band: a glow that never switches off
export const TROUGH = 0.4

// one glow: bright yellow eases (sine in and out) down to a partial fade toward the HEAD row's band and back,
// as 0x00RRGGBB per step, starting at the trough
export function breath(steps = PULSE_STEPS, bg = C.sel): number[] {
  const dim = mix(rgb(C.glow), rgb(bg), TROUGH)
  return Array.from({ length: steps }, (_, i) => mix(dim, rgb(C.glow), (1 - Math.cos((2 * Math.PI * i) / steps)) / 2))
}

// a 1x1 Raster's `cells`: one ● as little-endian u32 [codePoint, foreground, background], base64
export function dotCells(fg: number, bg: string = C.sel): string {
  const view = new DataView(new ArrayBuffer(12))
  ;[DOT.codePointAt(0) ?? 0, fg, rgb(bg)].forEach((word, i) => view.setUint32(i * 4, word, true))
  return btoa(String.fromCharCode(...new Uint8Array(view.buffer)))
}

// the graph segments cut around the ● cell; null when the row has none
export function splitDot(segs: Seg[]): { before: Seg[]; after: Seg[] } | null {
  const i = segs.findIndex(s => s.text.includes(DOT))
  const seg = segs[i]
  if (!seg) return null
  const at = seg.text.indexOf(DOT)
  const keep = (text: string): Seg[] => (text ? [{ ...seg, text }] : [])
  return {
    before: [...segs.slice(0, i), ...keep(seg.text.slice(0, at))],
    after: [...keep(seg.text.slice(at + 1)), ...segs.slice(i + 1)],
  }
}
