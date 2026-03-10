import { describe, expect, it } from 'vitest';
import {
  computeCropSourceRect,
  findOpaqueBounds,
  sliderValueToZoomScale,
  applyPolygonCutout,
  removeConnectedWhiteBackground,
  removeEdgeConnectedBackgroundByColor,
  zoomScaleToSliderValue,
} from './imageProcessing';

const createImageData = (
  width: number,
  height: number,
  fill: (x: number, y: number) => { r: number; g: number; b: number; a?: number },
): ImageData => {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const { r, g, b, a = 255 } = fill(x, y);
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }

  return { width, height, data } as ImageData;
};

describe('imageProcessing', () => {
  it('maps zoom slider around 1x with finer control and stable roundtrip', () => {
    expect(sliderValueToZoomScale(50)).toBeCloseTo(1, 4);
    expect(sliderValueToZoomScale(0)).toBeCloseTo(0.05, 4);
    expect(sliderValueToZoomScale(100)).toBeCloseTo(4, 4);

    const nearLeft = sliderValueToZoomScale(49);
    const nearRight = sliderValueToZoomScale(51);
    expect(nearLeft).toBeGreaterThan(0.93);
    expect(nearRight).toBeLessThan(1.05);

    expect(zoomScaleToSliderValue(1)).toBeCloseTo(50, 4);
    expect(zoomScaleToSliderValue(0.05)).toBeCloseTo(0, 4);
    expect(zoomScaleToSliderValue(4)).toBeCloseTo(100, 4);
  });

  it('preserves a concrete ImageData instance so browser canvas APIs accept the result', () => {
    class FakeImageData {
      width: number;
      height: number;
      data: Uint8ClampedArray;

      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    }

    const original = globalThis.ImageData;
    // @ts-expect-error test shim for environments without a DOM ImageData constructor
    globalThis.ImageData = FakeImageData;

    try {
      const input = new FakeImageData(
        new Uint8ClampedArray([
          255, 255, 255, 255,
          10, 20, 30, 255,
        ]),
        2,
        1,
      ) as unknown as ImageData;

      const cleaned = removeConnectedWhiteBackground(input, 245);

      expect(cleaned).toBeInstanceOf(FakeImageData);
    } finally {
      globalThis.ImageData = original;
    }
  });

  it('removes edge-connected white background while keeping colored subject pixels opaque', () => {
    const imageData = createImageData(5, 5, (x, y) => {
      if (x >= 1 && x <= 3 && y >= 1 && y <= 3) {
        return { r: 200, g: 40, b: 40 };
      }

      return { r: 255, g: 255, b: 255 };
    });

    const cleaned = removeConnectedWhiteBackground(imageData, 245);
    const topLeftAlpha = cleaned.data[3];
    const centerAlpha = cleaned.data[((2 * 5 + 2) * 4) + 3];

    expect(topLeftAlpha).toBe(0);
    expect(centerAlpha).toBe(255);
  });

  it('keeps enclosed white details instead of deleting all white pixels indiscriminately', () => {
    const imageData = createImageData(7, 7, (x, y) => {
      const inSubject = x >= 1 && x <= 5 && y >= 1 && y <= 5;
      const inHighlight = x >= 3 && x <= 4 && y >= 3 && y <= 4;

      if (inHighlight) {
        return { r: 255, g: 255, b: 255 };
      }

      if (inSubject) {
        return { r: 40, g: 160, b: 220 };
      }

      return { r: 255, g: 255, b: 255 };
    });

    const cleaned = removeConnectedWhiteBackground(imageData, 245);
    const highlightAlpha = cleaned.data[((3 * 7 + 3) * 4) + 3];
    const borderAlpha = cleaned.data[3];

    expect(borderAlpha).toBe(0);
    expect(highlightAlpha).toBe(255);
  });

  it('finds bounds from remaining opaque subject pixels', () => {
    const imageData = createImageData(6, 6, (x, y) => {
      if (x >= 2 && x <= 4 && y >= 1 && y <= 3) {
        return { r: 120, g: 80, b: 200 };
      }

      return { r: 255, g: 255, b: 255, a: 0 };
    });

    expect(findOpaqueBounds(imageData)).toEqual({
      left: 2,
      top: 1,
      right: 4,
      bottom: 3,
      width: 3,
      height: 3,
    });
  });

  it('removes edge-connected background by color for auto cutout on non-white backdrops', () => {
    const imageData = createImageData(6, 6, (x, y) => {
      if (x >= 2 && x <= 3 && y >= 2 && y <= 3) {
        return { r: 230, g: 70, b: 60 };
      }

      return { r: 30, g: 140, b: 200 };
    });

    const cleaned = removeEdgeConnectedBackgroundByColor(imageData, 40);

    const bgAlpha = cleaned.data[3];
    const fgAlpha = cleaned.data[((2 * 6 + 2) * 4) + 3];
    expect(bgAlpha).toBe(0);
    expect(fgAlpha).toBe(255);
  });

  it('supports polygon line selection cutout in keep/remove modes', () => {
    const imageData = createImageData(5, 5, () => ({ r: 40, g: 200, b: 120 }));
    const polygon = [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 3 },
      { x: 1, y: 3 },
    ];

    const kept = applyPolygonCutout(imageData, polygon, 'keep');
    expect(kept.data[3]).toBe(0);
    expect(kept.data[((2 * 5 + 2) * 4) + 3]).toBe(255);

    const removed = applyPolygonCutout(imageData, polygon, 'remove');
    expect(removed.data[3]).toBe(255);
    expect(removed.data[((2 * 5 + 2) * 4) + 3]).toBe(0);
  });

  it('computes clipped crop source rect from preview transform', () => {
    expect(
      computeCropSourceRect(
        { x: 20, y: 20, width: 200, height: 100 },
        { x: -30, y: 10 },
        2,
        300,
        200,
      ),
    ).toEqual({
      sx: 25,
      sy: 5,
      sw: 100,
      sh: 50,
    });

    expect(
      computeCropSourceRect(
        { x: 20, y: 20, width: 200, height: 100 },
        { x: 100, y: 100 },
        1,
        300,
        200,
      ),
    ).toEqual({
      sx: 0,
      sy: 0,
      sw: 120,
      sh: 20,
    });
  });
});
