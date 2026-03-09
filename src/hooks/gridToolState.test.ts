import { describe, expect, it } from 'vitest';
import type { Color } from '../types';
import { resolveSelectedColorForPalette, resolveToolAction } from './gridToolState';

const red: Color = { name: '红', hex: '#ff0000', rgb: { r: 255, g: 0, b: 0 } };
const blue: Color = { name: '蓝', hex: '#0000ff', rgb: { r: 0, g: 0, b: 255 } };

describe('gridToolState', () => {
  it('falls back to the first palette color when painting without an active color', () => {
    const result = resolveToolAction({
      drawMode: 'paint',
      selectedColor: null,
      clickedCell: null,
      paletteColors: [red, blue],
    });

    expect(result.shouldDraw).toBe(true);
    expect(result.strokeColor).toEqual(red);
    expect(result.nextSelectedColor).toEqual(red);
  });

  it('picks color from the clicked cell and switches back to paint mode', () => {
    const result = resolveToolAction({
      drawMode: 'pick',
      selectedColor: red,
      clickedCell: blue,
      paletteColors: [red, blue],
    });

    expect(result.shouldDraw).toBe(false);
    expect(result.nextSelectedColor).toEqual(blue);
    expect(result.nextDrawMode).toBe('paint');
  });

  it('keeps the current color when the new palette still contains it', () => {
    expect(resolveSelectedColorForPalette(red, [blue, red])).toEqual(red);
  });

  it('defaults to the first palette color when the current selection is unavailable', () => {
    expect(resolveSelectedColorForPalette(red, [blue])).toEqual(blue);
  });
});
