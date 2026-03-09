import { describe, expect, it } from 'vitest';
import type { Color, GridCell } from '../types';
import {
  getEllipseCells,
  getFloodFillCells,
  getLineCells,
  getMirroredPoints,
  getRectangleCells,
  getTriangleCells,
} from './pixelTools';

const red: Color = { name: '红', hex: '#ff0000', rgb: { r: 255, g: 0, b: 0 } };
const blue: Color = { name: '蓝', hex: '#0000ff', rgb: { r: 0, g: 0, b: 255 } };

const toKeySet = (points: { x: number; y: number }[]) => new Set(points.map((point) => `${point.x},${point.y}`));

describe('pixelTools', () => {
  it('builds a filled rectangle across a dragged bounding box', () => {
    const points = getRectangleCells({ x: 3, y: 3 }, { x: 1, y: 1 });

    expect(points).toHaveLength(9);
    expect(toKeySet(points)).toEqual(new Set([
      '1,1', '2,1', '3,1',
      '1,2', '2,2', '3,2',
      '1,3', '2,3', '3,3',
    ]));
  });

  it('builds a filled ellipse inside the drag box', () => {
    const points = getEllipseCells({ x: 0, y: 0 }, { x: 4, y: 4 });
    const keys = toKeySet(points);

    expect(keys.has('2,2')).toBe(true);
    expect(keys.has('2,0')).toBe(true);
    expect(keys.has('0,2')).toBe(true);
    expect(keys.has('0,0')).toBe(false);
    expect(keys.has('4,4')).toBe(false);
  });

  it('builds an isosceles filled triangle from the drag box', () => {
    const points = getTriangleCells({ x: 0, y: 0 }, { x: 4, y: 4 });
    const keys = toKeySet(points);

    expect(keys.has('2,0')).toBe(true);
    expect(keys.has('0,4')).toBe(true);
    expect(keys.has('4,4')).toBe(true);
    expect(keys.has('0,0')).toBe(false);
    expect(keys.has('4,0')).toBe(false);
  });

  it('builds a continuous Bresenham line', () => {
    expect(getLineCells({ x: 0, y: 0 }, { x: 3, y: 3 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]);
  });

  it('fills a contiguous region for the bucket tool', () => {
    const cells: GridCell[][] = [
      [red, red, blue],
      [red, null, blue],
      [null, null, blue],
    ];

    const points = getFloodFillCells(cells, { x: 0, y: 0 }, blue);

    expect(toKeySet(points)).toEqual(new Set(['0,0', '1,0', '0,1']));
  });

  it('supports filling empty cells as a region', () => {
    const cells: GridCell[][] = [
      [red, red, blue],
      [red, null, blue],
      [null, null, blue],
    ];

    const points = getFloodFillCells(cells, { x: 1, y: 1 }, red);

    expect(toKeySet(points)).toEqual(new Set(['1,1', '0,2', '1,2']));
  });

  it('returns the active and mirrored points for vertical symmetry', () => {
    expect(getMirroredPoints({ x: 1, y: 2 }, { width: 6, height: 5 }, 'vertical')).toEqual([
      { x: 1, y: 2 },
      { x: 4, y: 2 },
    ]);
  });

  it('deduplicates mirrored points on the center axis', () => {
    expect(getMirroredPoints({ x: 2, y: 2 }, { width: 5, height: 5 }, 'vertical')).toEqual([
      { x: 2, y: 2 },
    ]);
  });
});
