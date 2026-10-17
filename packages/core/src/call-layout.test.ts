import { describe, expect, it } from 'vitest'
import { fitGrid, TILE_ASPECT, TILE_GAP_PX } from './call-layout'

describe('fitGrid', () => {
  it('uses one large tile for a single participant', () => {
    const { cols, tileWidth } = fitGrid(1, 1600, 900)
    expect(cols).toBe(1)
    expect(tileWidth).toBe(1600)
  })

  it('is limited by the height in wide boxes', () => {
    const { cols, tileWidth } = fitGrid(1, 2000, 450)
    expect(cols).toBe(1)
    expect(tileWidth).toBe(Math.floor(450 * TILE_ASPECT))
  })

  it('puts two people side by side in a landscape box', () => {
    expect(fitGrid(2, 1200, 600).cols).toBe(2)
  })

  it('stacks two people in a portrait box (mobile)', () => {
    expect(fitGrid(2, 360, 640).cols).toBe(1)
  })

  it('never overflows the box', () => {
    for (const count of [3, 5, 7, 12]) {
      const width = 1100
      const height = 700
      const { cols, tileWidth } = fitGrid(count, width, height)
      const rows = Math.ceil(count / cols)
      expect(cols * tileWidth + (cols - 1) * TILE_GAP_PX).toBeLessThanOrEqual(width)
      expect(rows * (tileWidth / TILE_ASPECT) + (rows - 1) * TILE_GAP_PX).toBeLessThanOrEqual(height)
    }
  })

  it('handles an unmeasured box', () => {
    expect(fitGrid(3, 0, 0).tileWidth).toBe(0)
  })
})
