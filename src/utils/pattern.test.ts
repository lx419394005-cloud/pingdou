import { describe, expect, it } from 'vitest';
import type { Color, GridCell } from '../types';
import { buildIndexedPalette, buildColorLabelMap, getDisplayCode } from './pattern';

const red: Color = { name: '红', hex: '#ff0000', rgb: { r: 255, g: 0, b: 0 } };
const blue: Color = { name: '蓝', hex: '#0000ff', rgb: { r: 0, g: 0, b: 255 } };
const yellow: Color = { name: '黄', hex: '#ffff00', rgb: { r: 255, g: 255, b: 0 } };

describe('buildIndexedPalette', () => {
  it('assigns stable numeric codes by usage count', () => {
    const cells: GridCell[][] = [
      [red, red, blue],
      [yellow, blue, red],
      [null, blue, null],
    ];

    const entries = buildIndexedPalette(cells);

    expect(entries.map((entry) => ({
      code: entry.code,
      name: entry.color.name,
      count: entry.count,
    }))).toEqual([
      { code: 1, name: '红', count: 3 },
      { code: 2, name: '蓝', count: 3 },
      { code: 3, name: '黄', count: 1 },
    ]);
  });

  it('builds display labels with an alphabetic prefix for editor and export views', () => {
    const cells: GridCell[][] = [
      [{ ...red, name: 'A1' }, { ...blue, name: 'B2' }],
    ];

    const labelMap = buildColorLabelMap(cells);

    expect(labelMap.get(red.hex)).toBe('A1');
    expect(labelMap.get(blue.hex)).toBe('B2');
  });

  it('falls back to a prefixed code when palette names do not contain letter-number labels', () => {
    expect(getDisplayCode(7, '亮红')).toBe('C7');
    expect(getDisplayCode(3, '')).toBe('C3');
  });
});
