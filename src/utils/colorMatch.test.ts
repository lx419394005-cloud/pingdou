import { describe, expect, it } from 'vitest';
import type { Color } from '../types';
import { findNearestPaletteColor, mapGridPointToImagePixel, sampleOverlayColor } from './colorMatch';

const red: Color = { name: '红', hex: '#ff0000', rgb: { r: 255, g: 0, b: 0 } };
const blue: Color = { name: '蓝', hex: '#0000ff', rgb: { r: 0, g: 0, b: 255 } };

describe('colorMatch', () => {
  it('maps grid point to source image pixel using cell center', () => {
    const pixel = mapGridPointToImagePixel(24, 24, { width: 50, height: 50 }, 100, 100);
    expect(pixel).toEqual({ x: 49, y: 49 });
  });

  it('samples overlay rgb from mapped pixel', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    // pixel (1,2) in 4x4 image
    const index = (2 * 4 + 1) * 4;
    data[index] = 12;
    data[index + 1] = 34;
    data[index + 2] = 56;
    data[index + 3] = 255;
    const sampled = sampleOverlayColor({ width: 4, height: 4, data }, 7, 11, { width: 16, height: 16 });
    expect(sampled).toEqual({ r: 12, g: 34, b: 56 });
  });

  it('matches nearest palette color by rgb distance', () => {
    const nearest = findNearestPaletteColor({ r: 220, g: 20, b: 30 }, [blue, red]);
    expect(nearest).toEqual(red);
  });
});

