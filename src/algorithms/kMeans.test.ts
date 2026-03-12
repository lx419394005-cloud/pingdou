import { describe, expect, it } from 'vitest';
import type { Color, ProcessImageOptions } from '../types';
import { __testOnly, estimateRecommendedColorLimit, processImageToGrid, runMultiscalePatternPipeline } from './kMeans';
import mardPalette from '../data/colorCards/mard.json';
import { findOpaqueBounds, removeConnectedWhiteBackground } from '../utils/imageProcessing';
import { buildIndexedPalette } from '../utils/pattern';

const createImageData = (
  width: number,
  height: number,
  fill: (x: number, y: number) => { r: number; g: number; b: number; a?: number }
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

const makePalette = (size: number): Color[] => {
  const colors: Color[] = [];
  for (let i = 0; i < size; i++) {
    const r = (i * 37) % 256;
    const g = (i * 67) % 256;
    const b = (i * 97) % 256;
    colors.push({
      name: `C${i + 1}`,
      hex: `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
      rgb: { r, g, b },
    });
  }
  return colors;
};

const countUniqueColors = (cells: ReturnType<typeof processImageToGrid>) => {
  const set = new Set<string>();
  for (const row of cells) {
    for (const cell of row) {
      if (cell) set.add(cell.hex);
    }
  }
  return set.size;
};

const countCells = (
  cells: ReturnType<typeof processImageToGrid>,
  predicate: (cell: NonNullable<ReturnType<typeof processImageToGrid>[number][number]>) => boolean,
) => {
  let total = 0;
  for (const row of cells) {
    for (const cell of row) {
      if (cell && predicate(cell)) {
        total++;
      }
    }
  }
  return total;
};

const countOpaquePixels = (imageData: ImageData) => {
  let total = 0;
  for (let i = 3; i < imageData.data.length; i += 4) {
    if (imageData.data[i] >= 128) {
      total++;
    }
  }
  return total;
};

const createAvatarFixture = (width = 50, height = 50): ImageData => {
  const insideEllipse = (
    x: number,
    y: number,
    cx: number,
    cy: number,
    rx: number,
    ry: number,
  ) => (((x - cx) * (x - cx)) / (rx * rx)) + (((y - cy) * (y - cy)) / (ry * ry)) <= 1;

  const distanceToSegment = (
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
  ) => {
    const abx = bx - ax;
    const aby = by - ay;
    const abLengthSquared = (abx * abx) + (aby * aby);
    const projection = abLengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, (((px - ax) * abx) + ((py - ay) * aby)) / abLengthSquared));
    const closestX = ax + (abx * projection);
    const closestY = ay + (aby * projection);
    return Math.hypot(px - closestX, py - closestY);
  };

  return createImageData(width, height, (x, y) => {
    const head = insideEllipse(x, y, 23, 18, 12, 13);
    const earLeft = insideEllipse(x, y, 10, 20, 2.4, 3.2);
    const earRight = insideEllipse(x, y, 36, 20, 2.4, 3.2);
    const neck = x >= 20 && x <= 26 && y >= 28 && y <= 34;
    const shirt = y >= 31 && y <= 49 && x >= 4 && x <= 48 && (x >= 7 || y >= 34);
    const shirtCut = y <= 34 && x >= 17 && x <= 28;
    const shirtBody = shirt && !shirtCut;
    const strap = distanceToSegment(x, y, 14, 31, 22, 49) <= 1.15;

    const hairBase = y >= 2 && y <= 13 && x >= 10 && x <= 36 && !(
      (y <= 4 && ((x + y) % 4 === 0)) ||
      (y <= 6 && ((x * 2 + y) % 7 === 0))
    );
    const leftLens = x >= 13 && x <= 19 && y >= 16 && y <= 21;
    const rightLens = x >= 24 && x <= 30 && y >= 16 && y <= 21;
    const lensFrame = ((leftLens || rightLens) && (x === 13 || x === 19 || x === 24 || x === 30 || y === 16 || y === 21))
      || (y >= 18 && y <= 19 && x >= 19 && x <= 24)
      || (y >= 17 && y <= 20 && (x === 12 || x === 31));
    const leftEye = insideEllipse(x, y, 16, 18.5, 2.4, 2.1);
    const rightEye = insideEllipse(x, y, 27, 18.5, 2.4, 2.1);
    const pupil = insideEllipse(x, y, 16, 18.5, 0.8, 0.8) || insideEllipse(x, y, 27, 18.5, 0.8, 0.8);
    const browLeft = y >= 13 && y <= 14 && x >= 12 && x <= 18;
    const browRight = y >= 13 && y <= 14 && x >= 23 && x <= 29;
    const nose = (x === 21 && y >= 20 && y <= 24) || (y === 25 && x >= 20 && x <= 22);
    const mouth = y === 29 && x >= 16 && x <= 23;

    if (lensFrame || pupil || nose || mouth) {
      return { r: 20, g: 18, b: 18 };
    }

    if (browLeft || browRight) {
      return { r: 86, g: 60, b: 52 };
    }

    if (leftEye || rightEye) {
      return { r: 255, g: 255, b: 255 };
    }

    if (hairBase) {
      return { r: 101 + (x % 4), g: 73 + (y % 3), b: 68 + ((x + y) % 4) };
    }

    if (strap) {
      return { r: 145, g: 92, b: 58 };
    }

    if (shirtBody) {
      return { r: 118 + (x % 3), g: 112 + (y % 3), b: 116 + ((x + y) % 3) };
    }

    if (head || earLeft || earRight || neck) {
      return { r: 234 + (x % 3), g: 193 + (y % 3), b: 160 + ((x + y) % 3) };
    }

    return { r: 255, g: 255, b: 255 };
  });
};

const createComplexAvatarFixture = (width = 50, height = 50): ImageData => {
  const insideEllipse = (
    x: number,
    y: number,
    cx: number,
    cy: number,
    rx: number,
    ry: number,
  ) => (((x - cx) * (x - cx)) / (rx * rx)) + (((y - cy) * (y - cy)) / (ry * ry)) <= 1;

  const distanceToSegment = (
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
  ) => {
    const abx = bx - ax;
    const aby = by - ay;
    const abLengthSquared = (abx * abx) + (aby * aby);
    const projection = abLengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, (((px - ax) * abx) + ((py - ay) * aby)) / abLengthSquared));
    const closestX = ax + (abx * projection);
    const closestY = ay + (aby * projection);
    return Math.hypot(px - closestX, py - closestY);
  };

  return createImageData(width, height, (x, y) => {
    const head = insideEllipse(x, y, 23, 18, 12, 14);
    const earLeft = insideEllipse(x, y, 10, 20, 2.2, 3.2);
    const earRight = insideEllipse(x, y, 36, 20, 2.2, 3.2);
    const neck = x >= 20 && x <= 26 && y >= 28 && y <= 35;
    const neckShadow = x >= 20 && x <= 24 && y >= 31 && y <= 35;
    const shirt = y >= 31 && x >= 3 && x <= 49;
    const shirtShadow = shirt && (x > 30 || y > 42);
    const shirtMid = shirt && !shirtShadow && (x > 18 || y > 35);
    const strap = distanceToSegment(x, y, 14, 31, 22, 49) <= 1.1;
    const strapShadow = distanceToSegment(x, y, 15, 31, 23, 49) <= 0.7;

    const hair = y >= 2 && y <= 14 && x >= 9 && x <= 37;
    const hairLight = hair && y >= 4 && x >= 16 && x <= 34;
    const hairShadow = hair && !hairLight;
    const hairSpike = hair && ((y <= 5 && ((x + y) % 5 === 0)) || (y <= 7 && ((x * 3 + y) % 8 === 0)));

    const browLeft = y >= 13 && y <= 14 && x >= 12 && x <= 18;
    const browRight = y >= 13 && y <= 14 && x >= 23 && x <= 29;
    const frameLeft = ((x >= 12 && x <= 19 && y >= 16 && y <= 21) && (x === 12 || x === 19 || y === 16 || y === 21));
    const frameRight = ((x >= 24 && x <= 31 && y >= 16 && y <= 21) && (x === 24 || x === 31 || y === 16 || y === 21));
    const bridge = y >= 18 && y <= 19 && x >= 19 && x <= 24;
    const eyeLeftWhite = (x === 14 || x === 15) && y === 18;
    const eyeRightWhite = (x === 26 || x === 27) && y === 18;
    const pupilLeft = x === 16 && y === 18;
    const pupilRight = x === 28 && y === 18;
    const nose = (x === 21 && y >= 20 && y <= 24) || (x === 22 && y >= 22 && y <= 24);
    const mouth = y === 29 && x >= 17 && x <= 23;
    const cheekShade = head && y >= 20 && x >= 28;
    const jawShade = head && y >= 27;

    if (frameLeft || frameRight || bridge || pupilLeft || pupilRight || nose || mouth) {
      return { r: 20, g: 18, b: 18 };
    }

    if (eyeLeftWhite || eyeRightWhite) {
      return { r: 253, g: 251, b: 255 };
    }

    if (browLeft || browRight) {
      return { r: 97, g: 70, b: 60 };
    }

    if (hairSpike) {
      return { r: 88, g: 61, b: 56 };
    }

    if (hairShadow) {
      return { r: 96 + (x % 2), g: 68 + (y % 2), b: 63 };
    }

    if (hairLight) {
      return { r: 110 + (x % 2), g: 83 + (y % 2), b: 77 };
    }

    if (strapShadow) {
      return { r: 118, g: 72, b: 46 };
    }

    if (strap) {
      return { r: 145, g: 92, b: 58 };
    }

    if (shirtShadow) {
      return { r: 106, g: 109, b: 110 };
    }

    if (shirtMid) {
      return { r: 122, g: 124, b: 125 };
    }

    if (shirt) {
      return { r: 137, g: 139, b: 140 };
    }

    if (neckShadow) {
      return { r: 213, g: 154, b: 131 };
    }

    if (cheekShade || jawShade) {
      return { r: 227, g: 179, b: 149 };
    }

    if (head || earLeft || earRight || neck) {
      return { r: 236, g: 191, b: 156 };
    }

    return { r: 255, g: 255, b: 255 };
  });
};

const realPalette = mardPalette.colors as Color[];

describe('processImageToGrid', () => {
  it('should turn an image.png-like avatar into a compact bead chart with readable legend colors', () => {
    const source = createAvatarFixture();
    const cleaned = removeConnectedWhiteBackground(source, 245);
    const bounds = findOpaqueBounds(cleaned);

    expect(bounds).toEqual({
      left: 4,
      top: 2,
      right: 48,
      bottom: 49,
      width: 45,
      height: 48,
    });

    const nearest = processImageToGrid(cleaned, 50, 50, realPalette, { mode: 'legacy-nearest' });
    const clean = processImageToGrid(cleaned, 50, 50, realPalette, { mode: 'legacy-clean' });
    const indexed = buildIndexedPalette(clean);

    expect(clean[0][0]).toBeNull();
    expect(clean[49][0]).toBeNull();
    expect(clean[49][49]).toBeNull();
    expect(countUniqueColors(clean)).toBeLessThanOrEqual(6);
    expect(countUniqueColors(nearest)).toBeGreaterThan(countUniqueColors(clean));
    expect(indexed.map((entry) => entry.code)).toEqual([1, 2, 3, 4, 5, 6].slice(0, indexed.length));
    expect(indexed.reduce((sum, entry) => sum + entry.count, 0)).toBe(countOpaquePixels(cleaned));

    const darkDetailPixels = countCells(clean, (cell) => cell.rgb.r < 60 && cell.rgb.g < 60 && cell.rgb.b < 60);
    const skinPixels = countCells(clean, (cell) => cell.rgb.r > 200 && cell.rgb.g > 150 && cell.rgb.b > 120);
    const shirtPixels = countCells(
      clean,
      (cell) =>
        cell.rgb.r >= 95 &&
        cell.rgb.r <= 150 &&
        Math.abs(cell.rgb.r - cell.rgb.g) <= 18 &&
        Math.abs(cell.rgb.g - cell.rgb.b) <= 18,
    );
    const strapPixels = countCells(
      clean,
      (cell) => cell.rgb.r >= 110 && cell.rgb.r - cell.rgb.g >= 18 && cell.rgb.g - cell.rgb.b >= 10,
    );

    expect(darkDetailPixels).toBeGreaterThanOrEqual(50);
    expect(skinPixels).toBeGreaterThanOrEqual(250);
    expect(shirtPixels).toBeGreaterThanOrEqual(300);
    expect(strapPixels).toBeGreaterThanOrEqual(18);
  });

  it('should keep enclosed white eye highlights while stripping the outer white background before chart conversion', () => {
    const source = createAvatarFixture();
    const cleaned = removeConnectedWhiteBackground(source, 245);
    const leftEyeAlpha = cleaned.data[((18 * 50 + 14) * 4) + 3];
    const backgroundAlpha = cleaned.data[3];
    const clean = processImageToGrid(cleaned, 50, 50, realPalette, { mode: 'legacy-clean' });

    expect(backgroundAlpha).toBe(0);
    expect(leftEyeAlpha).toBe(255);
    expect(clean[18][14]).not.toBeNull();
    expect(clean[18][14]?.rgb.r).toBeGreaterThanOrEqual(210);
    expect(clean[18][14]?.rgb.g).toBeGreaterThanOrEqual(210);
    expect(clean[18][14]?.rgb.b).toBeGreaterThanOrEqual(210);
  });

  it('should still preserve bright eye whites when the clean pipeline keeps more than six colors', () => {
    const source = createAvatarFixture();
    const cleaned = removeConnectedWhiteBackground(source, 245);
    const clean = processImageToGrid(cleaned, 50, 50, realPalette, {
      mode: 'legacy-clean',
      targetColors: 8,
    });

    const brightEyePixels = [
      clean[18][14],
      clean[18][15],
      clean[18][25],
      clean[18][26],
    ].filter((cell) => cell && cell.rgb.r >= 210 && cell.rgb.g >= 210 && cell.rgb.b >= 210).length;

    expect(brightEyePixels).toBeGreaterThanOrEqual(2);
  });

  it('should preserve bright eye whites on a complex portrait where other dominant colors compete for palette slots', () => {
    const source = createComplexAvatarFixture();
    const cleaned = removeConnectedWhiteBackground(source, 245);
    const clean = processImageToGrid(cleaned, 50, 50, realPalette, {
      mode: 'legacy-clean',
      targetColors: 8,
    });

    const brightEyePixels = [
      clean[18][14],
      clean[18][15],
      clean[18][26],
      clean[18][27],
    ].filter((cell) => cell && cell.rgb.r >= 210 && cell.rgb.g >= 210 && cell.rgb.b >= 210).length;

    expect(brightEyePixels).toBeGreaterThanOrEqual(2);
  });

  it('should recommend fewer colors for flatter anime-style input than for varied input', () => {
    const width = 50;
    const height = 50;

    const flatImage = createImageData(width, height, (x, y) => {
      if (y < 14 && x > 10 && x < 38) return { r: 96, g: 68, b: 64 };
      if (x > 12 && x < 36 && y > 10 && y < 40) return { r: 232, g: 191, b: 156 };
      return { r: 246, g: 246, b: 246 };
    });

    const variedImage = createImageData(width, height, (x, y) => ({
      r: (x * 17 + y * 9) % 256,
      g: (x * 7 + y * 13) % 256,
      b: (x * 11 + y * 5) % 256,
    }));

    const flatRecommendation = estimateRecommendedColorLimit(flatImage, width, height);
    const variedRecommendation = estimateRecommendedColorLimit(variedImage, width, height);

    expect(flatRecommendation).toBeGreaterThanOrEqual(4);
    expect(flatRecommendation).toBeLessThanOrEqual(6);
    expect(variedRecommendation).toBeGreaterThan(flatRecommendation);
  });

  it('edge detector should detect hue-only boundaries with similar luminance', () => {
    const width = 20;
    const height = 20;
    const imageData = createImageData(width, height, (x) => {
      if (x < 10) {
        return { r: 0, g: 0, b: 224 };
      }
      return { r: 48, g: 16, b: 16 };
    });

    const mask = __testOnly.buildStrongEdgeMask(imageData, width, height);
    let boundaryHits = 0;
    for (let y = 1; y < height - 1; y++) {
      if (mask[y * width + 9] || mask[y * width + 10]) {
        boundaryHits++;
      }
    }

    expect(boundaryHits).toBeGreaterThanOrEqual(12);
  });

  it('legacy guided should not worsen boundary contamination vs legacy nearest', () => {
    const width = 50;
    const height = 50;
    const palette: Color[] = [
      { name: 'red', hex: '#ff0000', rgb: { r: 255, g: 0, b: 0 } },
      { name: 'blue', hex: '#0000ff', rgb: { r: 0, g: 0, b: 255 } },
      { name: 'purple', hex: '#7f007f', rgb: { r: 127, g: 0, b: 127 } },
      { name: 'pink', hex: '#ff66cc', rgb: { r: 255, g: 102, b: 204 } },
      { name: 'navy', hex: '#001133', rgb: { r: 0, g: 17, b: 51 } },
    ];

    const imageData = createImageData(width, height, (x, y) => {
      const isNoiseBlockLeft = x >= 8 && x <= 9 && y >= 8 && y <= 9;
      const isNoiseBlockRight = x >= 38 && x <= 39 && y >= 38 && y <= 39;
      if (isNoiseBlockLeft || isNoiseBlockRight) {
        return { r: 127, g: 0, b: 127 };
      }
      if (x < 24) return { r: 255, g: 0, b: 0 };
      if (x > 25) return { r: 0, g: 0, b: 255 };
      return { r: 127, g: 0, b: 127 };
    });

    const legacy = processImageToGrid(imageData, width, height, palette, { mode: 'legacy-nearest' });
    const guided = processImageToGrid(imageData, width, height, palette, { mode: 'legacy-guided' });

    const contamination = (cells: ReturnType<typeof processImageToGrid>) => {
      let noise = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const cell = cells[y][x];
          if (!cell) continue;
          const onLeft = x < 22;
          const onRight = x > 27;
          if (onLeft && cell.hex !== '#ff0000') noise++;
          if (onRight && cell.hex !== '#0000ff') noise++;
        }
      }
      const noisyPixels = [
        cells[8][8]?.hex, cells[8][9]?.hex, cells[9][8]?.hex, cells[9][9]?.hex,
        cells[38][38]?.hex, cells[38][39]?.hex, cells[39][38]?.hex, cells[39][39]?.hex,
      ].filter((hex) => hex === '#7f007f').length;
      return noise + noisyPixels;
    };

    expect(contamination(guided)).toBeLessThanOrEqual(contamination(legacy));
  });

  it('legacy guided should converge to a compact color set on portrait-like input', () => {
    const width = 50;
    const height = 50;
    const palette = realPalette;
    const imageData = createImageData(width, height, (x, y) => {
      const dx = x - 24;
      const dy = y - 24;
      const insideFace = ((dx * dx) / 196) + ((dy * dy) / 324) <= 1;
      const insideHair = y < 18 && x > 10 && x < 38;
      const insideShirt = y > 35;
      const onGlasses = (y === 21 || y === 22) && ((x >= 14 && x <= 20) || (x >= 27 && x <= 33));

      if (onGlasses) {
        return { r: 20, g: 20, b: 20 };
      }
      if (insideHair) {
        return { r: 92 + (x % 6), g: 64 + (y % 4), b: 62 + ((x + y) % 5) };
      }
      if (insideFace) {
        return { r: 229 + (x % 5), g: 188 + (y % 4), b: 154 + ((x + y) % 3) };
      }
      if (insideShirt) {
        return { r: 108 + (x % 5), g: 116 + (y % 4), b: 117 + ((x + y) % 3) };
      }
      return { r: 246, g: 246, b: 246 };
    });

    const cells = processImageToGrid(imageData, width, height, palette);
    expect(countUniqueColors(cells)).toBeLessThanOrEqual(28);
  });

  it('legacy-nearest mode should stay compatible with historical nearest mapping behavior', () => {
    const width = 4;
    const height = 2;
    const palette: Color[] = [
      { name: 'black', hex: '#000000', rgb: { r: 0, g: 0, b: 0 } },
      { name: 'white', hex: '#ffffff', rgb: { r: 255, g: 255, b: 255 } },
    ];
    const imageData = createImageData(width, height, (x, y) => {
      const v = (x + y) % 2 === 0 ? 10 : 240;
      return { r: v, g: v, b: v };
    });

    const legacy = processImageToGrid(imageData, width, height, palette, { mode: 'legacy-nearest' });

    expect(legacy[0][0]?.hex).toBe('#000000');
    expect(legacy[0][1]?.hex).toBe('#ffffff');
    expect(legacy[1][0]?.hex).toBe('#ffffff');
    expect(legacy[1][1]?.hex).toBe('#000000');
  });

  it('legacy guided should keep acceptable color fidelity on portrait-like input', () => {
    const width = 50;
    const height = 50;
    const palette = realPalette;
    const imageData = createImageData(width, height, (x, y) => {
      const dx = x - 24;
      const dy = y - 24;
      const insideFace = ((dx * dx) / 196) + ((dy * dy) / 324) <= 1;
      const insideHair = y < 18 && x > 10 && x < 38;
      const insideShirt = y > 35;
      const onGlasses = (y === 21 || y === 22) && ((x >= 14 && x <= 20) || (x >= 27 && x <= 33));

      if (onGlasses) {
        return { r: 18, g: 18, b: 18 };
      }
      if (insideHair) {
        return { r: 95 + (x % 7), g: 67 + (y % 3), b: 63 + ((x + y) % 5) };
      }
      if (insideFace) {
        return { r: 232 + (x % 4), g: 191 + (y % 3), b: 156 + ((x + y) % 4) };
      }
      if (insideShirt) {
        return { r: 104 + (x % 6), g: 111 + (y % 5), b: 115 + ((x + y) % 4) };
      }
      return { r: 245, g: 245, b: 245 };
    });

    const cells = processImageToGrid(imageData, width, height, palette);
    let error = 0;
    let count = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = cells[y][x];
        if (!cell) continue;
        const p = (y * width + x) * 4;
        const dr = imageData.data[p] - cell.rgb.r;
        const dg = imageData.data[p + 1] - cell.rgb.g;
        const db = imageData.data[p + 2] - cell.rgb.b;
        error += Math.sqrt((dr * dr) + (dg * dg) + (db * db));
        count++;
      }
    }

    const meanRgbError = count ? (error / count) : 0;
    expect(meanRgbError).toBeLessThanOrEqual(78);
  });

  it('legacy guided should finish 50x50 processing within quality budget', () => {
    const width = 50;
    const height = 50;
    const palette = makePalette(291);
    const imageData = createImageData(width, height, (x, y) => ({
      r: (x * 13 + y * 7) % 256,
      g: (x * 5 + y * 19) % 256,
      b: (x * 17 + y * 11) % 256,
    }));

    const start = performance.now();
    processImageToGrid(imageData, width, height, palette);
    const elapsedMs = performance.now() - start;

    expect(elapsedMs).toBeLessThanOrEqual(1500);
  });

  it('legacy guided should preserve 1px black strokes on bright regions', () => {
    const width = 30;
    const height = 30;
    const palette = makePalette(291);
    const imageData = createImageData(width, height, (x, y) => {
      const onVertical = x === 15 && y >= 4 && y <= 25;
      const onHorizontal = y === 12 && x >= 8 && x <= 22;
      if (onVertical || onHorizontal) {
        return { r: 0, g: 0, b: 0 };
      }
      return {
        r: (x * 7 + y * 13) % 256,
        g: (x * 11 + y * 5) % 256,
        b: (x * 3 + y * 17) % 256,
      };
    });

    const guided = processImageToGrid(imageData, width, height, palette, { mode: 'legacy-guided' });

    let totalStrokePixels = 0;
    let preservedBlack = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const onVertical = x === 15 && y >= 4 && y <= 25;
        const onHorizontal = y === 12 && x >= 8 && x <= 22;
        if (!onVertical && !onHorizontal) continue;
        totalStrokePixels++;
        if (guided[y][x]?.hex === '#000000') {
          preservedBlack++;
        }
      }
    }

    expect(preservedBlack / totalStrokePixels).toBeGreaterThanOrEqual(0.9);
  });

  it('legacy guided should preserve isolated 1px black details', () => {
    const width = 24;
    const height = 24;
    const palette = makePalette(291);
    const blackPoints = new Set(['5,5', '12,9', '18,15', '8,19']);
    const imageData = createImageData(width, height, (x, y) => {
      if (blackPoints.has(`${x},${y}`)) {
        return { r: 0, g: 0, b: 0 };
      }
      return { r: 232, g: 232, b: 232 };
    });

    const guided = processImageToGrid(imageData, width, height, palette, { mode: 'legacy-guided' });

    let kept = 0;
    for (const key of blackPoints) {
      const [x, y] = key.split(',').map(Number);
      const cell = guided[y][x];
      if (cell && cell.rgb.r < 40 && cell.rgb.g < 40 && cell.rgb.b < 40) {
        kept++;
      }
    }

    expect(kept).toBeGreaterThanOrEqual(3);
  });

  it('dark-detail mask should detect thin dark pixels under mild contrast', () => {
    const width = 24;
    const height = 24;
    const darkPoints = new Set(['6,6', '11,10', '17,14', '9,18']);
    const imageData = createImageData(width, height, (x, y) => {
      if (darkPoints.has(`${x},${y}`)) {
        return { r: 72, g: 72, b: 72 };
      }
      const base = 104 + ((x + y) % 6);
      return { r: base, g: base, b: base };
    });

    const mask = __testOnly.buildDarkDetailMask(imageData, width, height);
    let detected = 0;
    for (const key of darkPoints) {
      const [x, y] = key.split(',').map(Number);
      if (mask[y * width + x]) {
        detected++;
      }
    }

    expect(detected).toBeGreaterThanOrEqual(3);
  });

  it('legacy guided should use fewer colors than legacy nearest on portrait-like input', () => {
    const width = 50;
    const height = 50;
    const palette = makePalette(291);
    const imageData = createImageData(width, height, (x, y) => ({
      r: (x * 9 + y * 4) % 256,
      g: (x * 5 + y * 7) % 256,
      b: (x * 3 + y * 11) % 256,
    }));

    const legacy = processImageToGrid(imageData, width, height, palette, { mode: 'legacy-nearest' });
    const guided = processImageToGrid(imageData, width, height, palette, { mode: 'legacy-guided' });

    expect(countUniqueColors(guided)).toBeLessThan(countUniqueColors(legacy));
  });

  it('legacy guided should preserve a thin mouth line on skin tones', () => {
    const width = 28;
    const height = 28;
    const palette = makePalette(291);
    const imageData = createImageData(width, height, (x, y) => {
      const insideFace = x >= 7 && x <= 20 && y >= 6 && y <= 22;
      const onMouth = y === 18 && x >= 11 && x <= 16;
      if (onMouth) {
        return { r: 150, g: 90, b: 96 };
      }
      if (insideFace) {
        return { r: 232, g: 191, b: 156 };
      }
      return { r: 246, g: 246, b: 246 };
    });

    const guided = processImageToGrid(imageData, width, height, palette, { mode: 'legacy-guided' });

    let preserved = 0;
    for (let x = 11; x <= 16; x++) {
      const cell = guided[18][x];
      if (cell && cell.rgb.r < 190 && cell.rgb.g < 140) {
        preserved++;
      }
    }

    expect(preserved).toBeGreaterThanOrEqual(4);
  });

  it('legacy guided should reduce portrait-like input to six colors or fewer', () => {
    const width = 50;
    const height = 50;
    const palette = makePalette(291);
    const imageData = createImageData(width, height, (x, y) => {
      const dx = x - 24;
      const dy = y - 24;
      const insideFace = ((dx * dx) / 196) + ((dy * dy) / 324) <= 1;
      const insideHair = y < 18 && x > 10 && x < 38;
      const insideShirt = y > 35;
      const onGlasses = (y === 21 || y === 22) && ((x >= 14 && x <= 20) || (x >= 27 && x <= 33));
      const onMouth = y === 31 && x >= 21 && x <= 27;

      if (onGlasses) return { r: 18 + (x % 2), g: 18 + (y % 2), b: 18 };
      if (onMouth) return { r: 146 + (x % 2), g: 88 + (y % 2), b: 96 + ((x + y) % 2) };
      if (insideHair) return { r: 94 + (x % 8), g: 66 + (y % 5), b: 61 + ((x + y) % 6) };
      if (insideFace) return { r: 228 + (x % 7), g: 188 + (y % 5), b: 153 + ((x + y) % 4) };
      if (insideShirt) return { r: 104 + (x % 7), g: 110 + (y % 6), b: 113 + ((x + y) % 5) };
      return { r: 246, g: 246, b: 246 };
    });

    const guided = processImageToGrid(imageData, width, height, palette, { mode: 'legacy-guided' });
    expect(countUniqueColors(guided)).toBeLessThanOrEqual(6);
  });

  it('legacy clean should ignore contourImageData pollution and stay near legacy nearest structure', () => {
    const width = 50;
    const height = 50;
    const palette = realPalette;

    const lowRes = createImageData(width, height, (x, y) => {
      const dx = x - 24;
      const dy = y - 24;
      const insideFace = ((dx * dx) / 196) + ((dy * dy) / 324) <= 1;
      const insideHair = y < 18 && x > 10 && x < 38;
      const insideShirt = y > 35;
      const onMouth = y === 30 && x >= 21 && x <= 27;

      if (onMouth) return { r: 146, g: 88, b: 96 };
      if (insideHair) return { r: 96 + (x % 4), g: 68 + (y % 3), b: 64 };
      if (insideFace) return { r: 232 + (x % 3), g: 191 + (y % 3), b: 156 };
      if (insideShirt) return { r: 108, g: 114, b: 116 };
      return { r: 246, g: 246, b: 246 };
    });

    const contourImageData = createImageData(200, 200, (x, y) => {
      if ((x + y) % 11 === 0) return { r: 170, g: 120, b: 220 };
      return { r: 246, g: 246, b: 246 };
    });

    const clean = processImageToGrid(
      lowRes,
      width,
      height,
      palette,
      { mode: 'legacy-clean' as never, contourImageData } as ProcessImageOptions,
    );

    let purplePixels = 0;
    for (const row of clean) {
      for (const cell of row) {
        if (!cell) continue;
        if (cell.rgb.b > cell.rgb.r + 25 && cell.rgb.b > cell.rgb.g + 15) {
          purplePixels++;
        }
      }
    }

    let mouthPixels = 0;
    for (let x = 21; x <= 27; x++) {
      const cell = clean[30][x];
      if (cell && cell.rgb.r < 190 && cell.rgb.g < 150) {
        mouthPixels++;
      }
    }

    expect(purplePixels).toBe(0);
    expect(mouthPixels).toBeGreaterThanOrEqual(4);
  });

  it('legacy clean should reduce portrait-like input to six colors or fewer', () => {
    const width = 50;
    const height = 50;
    const palette = realPalette;

    const imageData = createImageData(width, height, (x, y) => {
      const dx = x - 24;
      const dy = y - 24;
      const insideFace = ((dx * dx) / 196) + ((dy * dy) / 324) <= 1;
      const insideHair = y < 18 && x > 10 && x < 38;
      const insideShirt = y > 35;
      const onGlasses = (y === 21 || y === 22) && ((x >= 14 && x <= 20) || (x >= 27 && x <= 33));
      const onMouth = y === 30 && x >= 21 && x <= 27;

      if (onGlasses) return { r: 18, g: 18, b: 18 };
      if (onMouth) return { r: 146, g: 88, b: 96 };
      if (insideHair) return { r: 96 + (x % 5), g: 68 + (y % 4), b: 64 + ((x + y) % 3) };
      if (insideFace) return { r: 232 + (x % 4), g: 191 + (y % 4), b: 156 + ((x + y) % 3) };
      if (insideShirt) return { r: 108 + (x % 4), g: 114 + (y % 4), b: 116 + ((x + y) % 3) };
      return { r: 246, g: 246, b: 246 };
    });

    const clean = processImageToGrid(
      imageData,
      width,
      height,
      palette,
      { mode: 'legacy-clean' as never } as ProcessImageOptions,
    );

    expect(countUniqueColors(clean)).toBeLessThanOrEqual(6);
  });

  it('legacy clean should honor a caller-provided target color limit', () => {
    const width = 50;
    const height = 50;
    const palette = realPalette;

    const imageData = createImageData(width, height, (x, y) => {
      const dx = x - 24;
      const dy = y - 24;
      const insideFace = ((dx * dx) / 196) + ((dy * dy) / 324) <= 1;
      const insideHair = y < 18 && x > 10 && x < 38;
      const insideShirt = y > 35;
      const onGlasses = (y === 21 || y === 22) && ((x >= 14 && x <= 20) || (x >= 27 && x <= 33));
      const onMouth = y === 30 && x >= 21 && x <= 27;

      if (onGlasses) return { r: 18, g: 18, b: 18 };
      if (onMouth) return { r: 146, g: 88, b: 96 };
      if (insideHair) return { r: 96 + (x % 5), g: 68 + (y % 4), b: 64 + ((x + y) % 3) };
      if (insideFace) return { r: 232 + (x % 4), g: 191 + (y % 4), b: 156 + ((x + y) % 3) };
      if (insideShirt) return { r: 108 + (x % 4), g: 114 + (y % 4), b: 116 + ((x + y) % 3) };
      return { r: 246, g: 246, b: 246 };
    });

    const clean = processImageToGrid(
      imageData,
      width,
      height,
      palette,
      { mode: 'legacy-clean', targetColors: 5 } as ProcessImageOptions,
    );

    expect(countUniqueColors(clean)).toBeLessThanOrEqual(5);
  });

  it('defaults to the legacy clean pipeline unless contour-locked is explicitly requested', () => {
    const source = createComplexAvatarFixture();
    const defaultResult = processImageToGrid(source, 50, 50, realPalette);
    const legacyClean = processImageToGrid(source, 50, 50, realPalette, { mode: 'legacy-clean' });

    expect(defaultResult).toEqual(legacyClean);
  });

  it('contour source should restore a thin mouth line missing from the 50x50 base image', () => {
    const width = 50;
    const height = 50;
    const palette = realPalette;
    const contourWidth = 200;
    const contourHeight = 200;

    const lowRes = createImageData(width, height, (x, y) => {
      const dx = x - 24;
      const dy = y - 24;
      const insideFace = ((dx * dx) / 196) + ((dy * dy) / 324) <= 1;
      const insideHair = y < 18 && x > 10 && x < 38;
      if (insideHair) return { r: 96, g: 68, b: 64 };
      if (insideFace) return { r: 232, g: 191, b: 156 };
      return { r: 246, g: 246, b: 246 };
    });

    const contourImageData = createImageData(contourWidth, contourHeight, (x, y) => {
      const dx = x - 96;
      const dy = y - 96;
      const faceValue = ((dx * dx) / (58 * 58)) + ((dy * dy) / (82 * 82));
      const hair = y < 72 && x > 40 && x < 150;
      const mouth = y >= 118 && y <= 120 && x >= 82 && x <= 110;
      const jawOutline = faceValue >= 0.9 && faceValue <= 1.03;
      if (mouth || jawOutline) return { r: 78, g: 66, b: 72 };
      if (hair) return { r: 96, g: 68, b: 64 };
      if (faceValue <= 1) return { r: 232, g: 191, b: 156 };
      return { r: 246, g: 246, b: 246 };
    });

    const guided = processImageToGrid(
      lowRes,
      width,
      height,
      palette,
      { mode: 'legacy-guided', contourImageData } as ProcessImageOptions,
    );

    let mouthPixels = 0;
    for (let x = 20; x <= 27; x++) {
      const cell = guided[30][x];
      if (cell && cell.rgb.r < 180 && cell.rgb.g < 150) {
        mouthPixels++;
      }
    }

    expect(mouthPixels).toBeGreaterThanOrEqual(4);
  });

  it('contour source should preserve a continuous cheek outline after color merging', () => {
    const width = 50;
    const height = 50;
    const palette = realPalette;
    const contourWidth = 200;
    const contourHeight = 200;

    const lowRes = createImageData(width, height, (x, y) => {
      const dx = x - 24;
      const dy = y - 24;
      const insideFace = ((dx * dx) / 196) + ((dy * dy) / 324) <= 1;
      if (insideFace) return { r: 232, g: 191, b: 156 };
      return { r: 246, g: 246, b: 246 };
    });

    const contourImageData = createImageData(contourWidth, contourHeight, (x, y) => {
      const dx = x - 96;
      const dy = y - 96;
      const value = ((dx * dx) / (58 * 58)) + ((dy * dy) / (82 * 82));
      const outline = value >= 0.92 && value <= 1.04;
      if (outline) return { r: 70, g: 64, b: 70 };
      if (value < 1) return { r: 232, g: 191, b: 156 };
      return { r: 246, g: 246, b: 246 };
    });

    const guided = processImageToGrid(
      lowRes,
      width,
      height,
      palette,
      { mode: 'legacy-guided', contourImageData } as ProcessImageOptions,
    );

    let outlineRows = 0;
    for (let y = 16; y <= 37; y++) {
      let rowHit = false;
      for (let x = 8; x <= 11; x++) {
        const cell = guided[y][x];
        if (cell && cell.rgb.r < 180 && cell.rgb.g < 150) {
          rowHit = true;
          break;
        }
      }
      if (rowHit) {
        outlineRows++;
      }
    }

    expect(outlineRows).toBeGreaterThanOrEqual(10);
  });

  it('locked contour extraction should not flood smooth face regions', () => {
    const width = 50;
    const height = 50;
    const contourWidth = 200;
    const contourHeight = 200;

    const contourImageData = createImageData(contourWidth, contourHeight, (x, y) => {
      const dx = x - 96;
      const dy = y - 96;
      const value = ((dx * dx) / (58 * 58)) + ((dy * dy) / (82 * 82));
      const outline = value >= 0.94 && value <= 1.02;
      if (outline) return { r: 70, g: 64, b: 70 };
      if (value < 1) {
        return {
          r: 224 + Math.floor((x - 96) / 24),
          g: 186 + Math.floor((y - 96) / 30),
          b: 154 + Math.floor((x + y - 192) / 36),
        };
      }
      return { r: 246, g: 246, b: 246 };
    });

    const locked = __testOnly.extractLockedContours(contourImageData, width, height);
    let totalLocked = 0;
    for (const cell of locked.mask) {
      totalLocked += cell;
    }

    expect(locked.mask[25 * width + 25]).toBe(0);
    expect(totalLocked).toBeLessThanOrEqual(180);
  });

  it('keeps eye whites as their own feature region before final palette compression', () => {
    const source = createComplexAvatarFixture(180, 180);
    const result = runMultiscalePatternPipeline(source, 50, 50, realPalette, {
      workingResolution: 120,
      targetColors: 8,
    });

    const brightEyePixels = [
      result[18][14],
      result[18][15],
      result[18][26],
      result[18][27],
    ].filter((cell) => cell && cell.rgb.r >= 210 && cell.rgb.g >= 210 && cell.rgb.b >= 210).length;

    expect(brightEyePixels).toBeGreaterThanOrEqual(2);
  });

  it('keeps thin jaw contours continuous after multiscale projection', () => {
    const source = createComplexAvatarFixture(180, 180);
    const result = runMultiscalePatternPipeline(source, 50, 50, realPalette, {
      workingResolution: 120,
      targetColors: 8,
    });

    let jawRows = 0;
    for (let y = 31; y <= 37; y++) {
      const rowHasContour = [12, 13, 36, 37].some((x) => {
        const cell = result[y][x];
        return cell && cell.rgb.r < 180 && cell.rgb.g < 150;
      });
      if (rowHasContour) {
        jawRows++;
      }
    }

    expect(jawRows).toBeGreaterThanOrEqual(4);
  });

  it('merges shirt, skin, and hair into large blocks before final palette compression', () => {
    const source = createComplexAvatarFixture(180, 180);
    const result = runMultiscalePatternPipeline(source, 50, 50, realPalette, {
      workingResolution: 120,
      targetColors: 8,
    });

    const hairPixels = countCells(
      result,
      (cell) => cell.rgb.r >= 80 && cell.rgb.r <= 125 && cell.rgb.g >= 55 && cell.rgb.g <= 95,
    );
    const skinPixels = countCells(
      result,
      (cell) => cell.rgb.r >= 200 && cell.rgb.g >= 150 && cell.rgb.b >= 120,
    );
    const shirtPixels = countCells(
      result,
      (cell) => cell.rgb.r >= 95 && cell.rgb.r <= 150 && Math.abs(cell.rgb.r - cell.rgb.g) <= 22,
    );

    expect(countUniqueColors(result)).toBeLessThanOrEqual(8);
    expect(hairPixels).toBeGreaterThanOrEqual(24);
    expect(skinPixels).toBeGreaterThanOrEqual(180);
    expect(shirtPixels).toBeGreaterThanOrEqual(180);
  });

  it('ink-outline-fill should lock only near-black contour lines and ignore brown inner details', () => {
    const width = 50;
    const height = 50;
    const contourWidth = 200;
    const contourHeight = 200;

    const baseImage = createImageData(width, height, (x, y) => {
      const dx = x - 24;
      const dy = y - 25;
      const inside = ((dx * dx) / (14 * 14)) + ((dy * dy) / (17 * 17)) <= 1;
      if (inside) {
        return { r: 232, g: 191, b: 156 };
      }
      return { r: 244, g: 244, b: 244 };
    });

    const contourImageData = createImageData(contourWidth, contourHeight, (x, y) => {
      const dx = x - 96;
      const dy = y - 100;
      const value = ((dx * dx) / (56 * 56)) + ((dy * dy) / (72 * 72));
      const blackOutline = value >= 0.96 && value <= 1.02;
      const brownInnerLine = x >= 96 && x <= 99 && y >= 70 && y <= 128;

      if (blackOutline) return { r: 18, g: 18, b: 18 };
      if (brownInnerLine) return { r: 98, g: 72, b: 62 };
      if (value < 1) return { r: 232, g: 191, b: 156 };
      return { r: 244, g: 244, b: 244 };
    });

    const result = processImageToGrid(
      baseImage,
      width,
      height,
      realPalette,
      { mode: 'ink-outline-fill' as never, contourImageData } as ProcessImageOptions,
    );

    let contourHits = 0;
    for (let y = 14; y <= 36; y++) {
      for (const x of [10, 11, 37, 38]) {
        const cell = result[y][x];
        if (cell && cell.rgb.r <= 70 && cell.rgb.g <= 70 && cell.rgb.b <= 70) {
          contourHits++;
        }
      }
    }

    let innerBrownLineDarkHits = 0;
    for (let y = 18; y <= 32; y++) {
      const cell = result[y][25];
      if (cell && cell.rgb.r <= 70 && cell.rgb.g <= 70 && cell.rgb.b <= 70) {
        innerBrownLineDarkHits++;
      }
    }

    expect(contourHits).toBeGreaterThanOrEqual(10);
    expect(innerBrownLineDarkHits).toBeLessThanOrEqual(1);
  });

  it('ink-outline-fill contourThreshold should control outline sensitivity', () => {
    const width = 50;
    const height = 50;
    const contourWidth = 200;
    const contourHeight = 200;

    const baseImage = createImageData(width, height, (x, y) => {
      const dx = x - 24;
      const dy = y - 25;
      const inside = ((dx * dx) / (14 * 14)) + ((dy * dy) / (17 * 17)) <= 1;
      if (inside) {
        return { r: 232, g: 191, b: 156 };
      }
      return { r: 244, g: 244, b: 244 };
    });

    const contourImageData = createImageData(contourWidth, contourHeight, (x, y) => {
      const dx = x - 96;
      const dy = y - 100;
      const value = ((dx * dx) / (56 * 56)) + ((dy * dy) / (72 * 72));
      const softDarkOutline = value >= 0.97 && value <= 1.03;
      if (softDarkOutline) return { r: 92, g: 82, b: 76 };
      if (value < 1) return { r: 232, g: 191, b: 156 };
      return { r: 244, g: 244, b: 244 };
    });

    const lowThreshold = processImageToGrid(
      baseImage,
      width,
      height,
      realPalette,
      { mode: 'ink-outline-fill' as never, contourImageData, contourThreshold: 10 } as ProcessImageOptions,
    );
    const highThreshold = processImageToGrid(
      baseImage,
      width,
      height,
      realPalette,
      { mode: 'ink-outline-fill' as never, contourImageData, contourThreshold: 90 } as ProcessImageOptions,
    );

    const countDarkPixels = (cells: ReturnType<typeof processImageToGrid>) => {
      let total = 0;
      for (let y = 10; y <= 40; y++) {
        for (let x = 8; x <= 40; x++) {
          const cell = cells[y][x];
          if (cell && cell.rgb.r <= 70 && cell.rgb.g <= 70 && cell.rgb.b <= 70) {
            total++;
          }
        }
      }
      return total;
    };

    expect(countDarkPixels(highThreshold)).toBeGreaterThan(countDarkPixels(lowThreshold));
  });
});
