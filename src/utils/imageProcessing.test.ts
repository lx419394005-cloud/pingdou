import { describe, expect, it } from 'vitest';
import { findOpaqueBounds, removeConnectedWhiteBackground } from './imageProcessing';

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
});
