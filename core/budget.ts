// The desktop drew nothing for a ~170k-char pane tree; the API's tree bounds are 100,000 serialized characters,
// 20,000 nodes, 32 deep, so a remote surface gets a tree under that (unconfirmed which bound the desktop applies)
// ponytail: the cap is a row count found by re-drawing (size is near linear in rows); trim per-node props or
// window by scroll if the desktop ever sends one, to show every commit again
export const BUDGET = 90_000
export const MIN_ROWS = 20
export const TRIES = 3

// the row count to draw next: the same when the tree fits, else scaled by budget/size with 10% margin
export function fitRows(rows: number, size: number, budget = BUDGET): number {
  if (size <= budget) return rows
  return Math.min(rows - 1, Math.max(MIN_ROWS, Math.floor((rows * budget * 0.9) / size)))
}
