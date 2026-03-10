import { describe, expect, it } from 'vitest';
import type { GridCell } from '../types';
import { applySelectionMove, getSelectionRectPoints, translateSelectionPoints } from './selectionTools';

describe('selectionTools', () => {
  it('builds rectangle points regardless of drag direction', () => {
    const points = getSelectionRectPoints(
      { x: 3, y: 3 },
      { x: 1, y: 2 },
      { width: 5, height: 5 },
    );

    expect(points).toEqual([
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 1, y: 3 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
    ]);
  });

  it('translates selected points and clips overflow targets', () => {
    const next = translateSelectionPoints(
      [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      { x: 1, y: 2 },
      { width: 3, height: 3 },
    );

    expect(next).toEqual([{ x: 1, y: 2 }, { x: 2, y: 3 }].filter((point) => point.y < 3));
  });

  it('moves selected cells with cut-and-paste semantics', () => {
    const cells: GridCell[][] = [
      [{ name: 'A', hex: '#111', rgb: { r: 17, g: 17, b: 17 } }, null, null],
      [null, { name: 'B', hex: '#222', rgb: { r: 34, g: 34, b: 34 } }, null],
      [null, null, null],
    ];

    const result = applySelectionMove(
      cells,
      [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      { x: 1, y: 1 },
      { width: 3, height: 3 },
    );

    expect(result.changed).toBe(true);
    expect(result.selection).toEqual([{ x: 1, y: 1 }, { x: 2, y: 2 }]);
    expect(result.cells[0][0]).toBeNull();
    expect(result.cells[1][1]?.hex).toBe('#111');
    expect(result.cells[2][2]?.hex).toBe('#222');
  });
});
