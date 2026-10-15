export const TILE_GAP_PX = 8
export const TILE_ASPECT = 16 / 9

/**
 * Columns and tile width that make `count` 16:9 tiles as large as possible in a box,
 * the way Discord sizes its voice channel grid.
 */
export function fitGrid(count: number, width: number, height: number): { cols: number; tileWidth: number } {
  let best = { cols: 1, tileWidth: 0 }
  for (let cols = 1; cols <= Math.max(1, count); cols += 1) {
    const rows = Math.ceil(count / cols)
    let tileWidth = (width - TILE_GAP_PX * (cols - 1)) / cols
    const neededHeight = (tileWidth / TILE_ASPECT) * rows + TILE_GAP_PX * (rows - 1)
    if (neededHeight > height) tileWidth = ((height - TILE_GAP_PX * (rows - 1)) / rows) * TILE_ASPECT
    if (tileWidth > best.tileWidth) best = { cols, tileWidth }
  }
  return { cols: best.cols, tileWidth: Math.max(0, Math.floor(best.tileWidth)) }
}
