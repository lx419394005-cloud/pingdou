import { describe, expect, it } from 'vitest';
import type { Color } from '../types';
import { buildBrushPaletteState } from './brushPalette';
import type { IndexedPaletteEntry } from './pattern';

const makeColor = (name: string, hex: string): Color => ({
  name,
  hex,
  rgb: {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  },
});

describe('buildBrushPaletteState', () => {
  it('uses the current indexed palette as the 8 quick brush colors', () => {
    const entries = Array.from({ length: 10 }, (_, index) => ({
      code: index + 1,
      color: makeColor(`C${index + 1}`, `#${(index + 1).toString(16).padStart(6, '0')}`),
      count: 10 - index,
    })) satisfies IndexedPaletteEntry[];

    const result = buildBrushPaletteState(entries, [], null);

    expect(result.quickColors).toHaveLength(8);
    expect(result.quickColors[0].name).toBe('C1');
    expect(result.quickColors[7].name).toBe('C8');
  });

  it('exposes a custom slot when the selected color is outside the current quick colors', () => {
    const red = makeColor('红', '#ff0000');
    const blue = makeColor('蓝', '#0000ff');
    const yellow = makeColor('黄', '#ffff00');

    const result = buildBrushPaletteState(
      [{ code: 1, color: red, count: 8 }, { code: 2, color: blue, count: 5 }],
      [red, blue, yellow],
      yellow,
    );

    expect(result.quickColors.map((color) => color.hex)).toEqual(['#ff0000', '#0000ff']);
    expect(result.customColor?.hex).toBe('#ffff00');
  });
});
