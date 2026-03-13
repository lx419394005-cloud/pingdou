import type { AlgorithmMode, Color, GridCell, ProcessImageOptions } from '../types';
import { deltaE, findNearestColor, rgbToLab, type LabColor } from '../utils/colorUtils';
import { applyBlackOutlineToImageData } from '../utils/imageProcessing';
import { extractFeatureMaps } from './featureExtraction';
import { projectMosaicToGrid } from './gridProjection';
import { buildRegionMosaic } from './regionMosaic';
import { rasterizeWorkingGrid, renderFeatureMapsToWorkingGrid } from './workingGrid';

interface PixelPoint {
  index: number;
  x: number;
  y: number;
  rgb: { r: number; g: number; b: number };
  lab: LabColor;
}

interface Region {
  pixels: number[];
  averageLab: LabColor;
  weight: number;
}

interface WeightedSample {
  lab: LabColor;
  weight: number;
}

interface WeightedKMeansResult {
  labels: Uint16Array;
  centers: LabColor[];
  weightedError: number;
}

interface ColorStats {
  color: Color;
  count: number;
  brightness: number;
  chroma: number;
  sumLab: LabColor;
  edgeCount: number;
  darkDetailCount: number;
  featureCount: number;
  backgroundCount: number;
}

interface LockedContourResult {
  mask: Uint8Array;
  colors: Array<{ r: number; g: number; b: number } | null>;
}

const GUIDED_K_CANDIDATES = [10, 12, 14, 16, 18];
const GUIDED_TARGET_ERROR = 9.5;
const GUIDED_PROTECTED_MAX_COLORS = 6;
const REGION_SEED_THRESHOLD = 14;
const REGION_AVERAGE_THRESHOLD = 10;
const GUIDED_TOTAL_MAX_COLORS = 6;
const GUIDED_EDGE_PALETTE_SIZE = 3;
const GUIDED_LOCKED_CONTOUR_MAX_COLORS = 2;
const CLEAN_TARGET_COLORS = 6;
const CLEAN_PROTECTED_COLOR_SLOTS = 2;
export const MIN_TARGET_COLORS = 4;
export const MAX_TARGET_COLORS = 12;

const clampTargetColors = (value: number): number =>
  Math.max(MIN_TARGET_COLORS, Math.min(MAX_TARGET_COLORS, Math.round(value)));

const createSeededRandom = (seed: number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
};

const squaredLabDistance = (c1: LabColor, c2: LabColor): number => {
  const dl = c1.l - c2.l;
  const da = c1.a - c2.a;
  const db = c1.b - c2.b;
  return dl * dl + da * da + db * db;
};

const makeGrid = (width: number, height: number): GridCell[][] =>
  Array.from({ length: height }, () => Array<GridCell>(width).fill(null));

const buildStrongEdgeMask = (
  imageData: ImageData,
  width: number,
  height: number,
  expand = true,
): Uint8Array => {
  const { data } = imageData;
  const lChannel = new Float32Array(width * height);
  const aChannel = new Float32Array(width * height);
  const bChannel = new Float32Array(width * height);
  const alpha = new Uint8Array(width * height);

  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const lab = rgbToLab(data[idx], data[idx + 1], data[idx + 2]);
    lChannel[i] = lab.l;
    aChannel[i] = lab.a;
    bChannel[i] = lab.b;
    alpha[i] = data[idx + 3];
  }

  const sobelAt = (channel: Float32Array, idx: number): { gx: number; gy: number } => {
    const gx =
      -channel[idx - width - 1] + channel[idx - width + 1] +
      (-2 * channel[idx - 1]) + (2 * channel[idx + 1]) +
      -channel[idx + width - 1] + channel[idx + width + 1];
    const gy =
      channel[idx - width - 1] + (2 * channel[idx - width]) + channel[idx - width + 1] +
      -channel[idx + width - 1] - (2 * channel[idx + width]) - channel[idx + width + 1];
    return { gx, gy };
  };

  const magnitudes: number[] = [];
  const magnitudesArray = new Float32Array(width * height);
  const alphaEdges = new Uint8Array(width * height);
  const chromaWeight = 0.45;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const { gx: gxL, gy: gyL } = sobelAt(lChannel, idx);
      const { gx: gxA, gy: gyA } = sobelAt(aChannel, idx);
      const { gx: gxB, gy: gyB } = sobelAt(bChannel, idx);

      const magnitude = Math.sqrt(
        (gxL * gxL) + (gyL * gyL) +
        (chromaWeight * ((gxA * gxA) + (gyA * gyA) + (gxB * gxB) + (gyB * gyB)))
      );

      let hasAlphaBoundary = false;
      for (let dy = -1; dy <= 1 && !hasAlphaBoundary; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const neighborIdx = (y + dy) * width + (x + dx);
          if (Math.abs(alpha[idx] - alpha[neighborIdx]) > 64) {
            hasAlphaBoundary = true;
            break;
          }
        }
      }

      if (hasAlphaBoundary) {
        alphaEdges[idx] = 1;
      }

      magnitudes.push(magnitude);
      magnitudesArray[idx] = magnitude;
    }
  }

  if (magnitudes.length === 0) {
    return new Uint8Array(width * height);
  }

  const sorted = magnitudes.slice().sort((a, b) => a - b);
  const high = Math.max(8, sorted[Math.floor(sorted.length * 0.78)]);
  const low = Math.max(4, high * 0.58);

  const queue: number[] = [];
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    if (magnitudesArray[i] >= high || alphaEdges[i]) {
      mask[i] = 1;
      queue.push(i);
    }
  }

  while (queue.length > 0) {
    const idx = queue.pop() as number;
    const x = idx % width;
    const y = Math.floor(idx / width);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx <= 0 || ny <= 0 || nx >= width - 1 || ny >= height - 1) continue;
        const neighborIdx = ny * width + nx;
        if (mask[neighborIdx]) continue;
        if (magnitudesArray[neighborIdx] >= low) {
          mask[neighborIdx] = 1;
          queue.push(neighborIdx);
        }
      }
    }
  }

  if (!expand) {
    return mask;
  }

  const expanded = mask.slice();
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (!mask[idx]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          expanded[(y + dy) * width + (x + dx)] = 1;
        }
      }
    }
  }

  return expanded;
};

const buildDarkDetailMask = (imageData: ImageData, width: number, height: number): Uint8Array => {
  const { data } = imageData;
  const luminance = new Float32Array(width * height);
  const opaqueLum: number[] = [];

  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const y = (0.299 * data[idx]) + (0.587 * data[idx + 1]) + (0.114 * data[idx + 2]);
    luminance[i] = y;
    if (data[idx + 3] >= 128) {
      opaqueLum.push(y);
    }
  }

  if (opaqueLum.length === 0) {
    return new Uint8Array(width * height);
  }

  const sorted = opaqueLum.slice().sort((a, b) => a - b);
  const p15 = sorted[Math.floor(sorted.length * 0.15)];
  const darkThreshold = Math.min(95, p15 + 18);
  const mask = new Uint8Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (data[(idx * 4) + 3] < 128) continue;

      const center = luminance[idx];
      if (center > darkThreshold) continue;

      const left = luminance[idx - 1];
      const right = luminance[idx + 1];
      const up = luminance[idx - width];
      const down = luminance[idx + width];
      const maxNeighbor = Math.max(left, right, up, down);
      const minNeighbor = Math.min(left, right, up, down);
      const horizontalBridge = (left - center >= 10) && (right - center >= 10);
      const verticalBridge = (up - center >= 10) && (down - center >= 10);
      const localMinimum = center <= (minNeighbor + 2);

      if ((horizontalBridge || verticalBridge) && localMinimum && (maxNeighbor - center >= 12)) {
        mask[idx] = 1;
      }
    }
  }

  return mask;
};

const buildFeatureDetailMask = (imageData: ImageData, width: number, height: number): Uint8Array => {
  const { data } = imageData;
  const labPixels = new Array<LabColor>(width * height);

  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    labPixels[i] = rgbToLab(data[idx], data[idx + 1], data[idx + 2]);
  }

  const averageLab = (a: LabColor, b: LabColor): LabColor => ({
    l: (a.l + b.l) / 2,
    a: (a.a + b.a) / 2,
    b: (a.b + b.b) / 2,
  });

  const mask = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (data[(idx * 4) + 3] < 128) continue;

      const center = labPixels[idx];
      const left = labPixels[idx - 1];
      const right = labPixels[idx + 1];
      const up = labPixels[idx - width];
      const down = labPixels[idx + width];

      const horizontalBridge = deltaE(left, right) <= 7;
      const verticalBridge = deltaE(up, down) <= 7;
      const horizontalContrast = deltaE(center, averageLab(left, right));
      const verticalContrast = deltaE(center, averageLab(up, down));
      const horizontalDarkening = ((left.l + right.l) / 2) - center.l;
      const verticalDarkening = ((up.l + down.l) / 2) - center.l;

      const centerChroma = Math.hypot(center.a, center.b);
      const horizontalChroma = Math.hypot((left.a + right.a) / 2, (left.b + right.b) / 2);
      const verticalChroma = Math.hypot((up.a + down.a) / 2, (up.b + down.b) / 2);

      const hasHorizontalFeature =
        horizontalBridge &&
        (
          (horizontalContrast >= 8 && Math.abs(centerChroma - horizontalChroma) >= 4) ||
          (horizontalContrast >= 6 && horizontalDarkening >= 4)
        );
      const hasVerticalFeature =
        verticalBridge &&
        (
          (verticalContrast >= 8 && Math.abs(centerChroma - verticalChroma) >= 4) ||
          (verticalContrast >= 6 && verticalDarkening >= 4)
        );

      if (hasHorizontalFeature || hasVerticalFeature) {
        mask[idx] = 1;
      }
    }
  }

  return mask;
};

const buildBrightDetailMask = (imageData: ImageData, width: number, height: number): Uint8Array => {
  const { data } = imageData;
  const luminance = new Float32Array(width * height);
  const opaqueLum: number[] = [];

  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const y = (0.299 * data[idx]) + (0.587 * data[idx + 1]) + (0.114 * data[idx + 2]);
    luminance[i] = y;
    if (data[idx + 3] >= 128) {
      opaqueLum.push(y);
    }
  }

  if (opaqueLum.length === 0) {
    return new Uint8Array(width * height);
  }

  const sorted = opaqueLum.slice().sort((a, b) => a - b);
  const p85 = sorted[Math.floor(sorted.length * 0.85)];
  const brightThreshold = Math.max(226, p85 + 8);
  const mask = new Uint8Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (data[(idx * 4) + 3] < 128) continue;

      const center = luminance[idx];
      if (center < brightThreshold) continue;

      const left = luminance[idx - 1];
      const right = luminance[idx + 1];
      const up = luminance[idx - width];
      const down = luminance[idx + width];
      const darkerNeighbors = [left, right, up, down].filter((value) => center - value >= 14).length;
      const horizontalPocket = (center - left >= 12) && (center - right >= 12);
      const verticalPocket = (center - up >= 12) && (center - down >= 12);
      const localMaximum = center >= Math.max(left, right, up, down) - 2;

      if (localMaximum && darkerNeighbors >= 2 && (horizontalPocket || verticalPocket)) {
        mask[idx] = 1;
      }
    }
  }

  return mask;
};

const mergeMasks = (primary: Uint8Array, secondary: Uint8Array): Uint8Array => {
  const merged = new Uint8Array(primary.length);
  for (let i = 0; i < primary.length; i++) {
    merged[i] = (primary[i] || secondary[i]) ? 1 : 0;
  }
  return merged;
};

const repairContourMask = (mask: Uint8Array, width: number, height: number): Uint8Array => {
  const repaired = mask.slice();

  for (let pass = 0; pass < 2; pass++) {
    const next = repaired.slice();
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (repaired[idx]) continue;

        const left = repaired[idx - 1];
        const right = repaired[idx + 1];
        const up = repaired[idx - width];
        const down = repaired[idx + width];
        const upLeft = repaired[idx - width - 1];
        const upRight = repaired[idx - width + 1];
        const downLeft = repaired[idx + width - 1];
        const downRight = repaired[idx + width + 1];

        const bridges =
          (left && right) ||
          (up && down) ||
          (upLeft && downRight) ||
          (upRight && downLeft);

        if (bridges) {
          next[idx] = 1;
        }
      }
    }
    repaired.set(next);
  }

  return repaired;
};

const thinContourMask = (
  mask: Uint8Array,
  preserveMask: Uint8Array,
  width: number,
  height: number,
): Uint8Array => {
  const thinned = mask.slice();

  const next = thinned.slice();
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (!thinned[idx] || preserveMask[idx]) continue;

      const left = thinned[idx - 1];
      const right = thinned[idx + 1];
      const up = thinned[idx - width];
      const down = thinned[idx + width];
      const upLeft = thinned[idx - width - 1];
      const upRight = thinned[idx - width + 1];
      const downLeft = thinned[idx + width - 1];
      const downRight = thinned[idx + width + 1];
      const neighborCount = left + right + up + down + upLeft + upRight + downLeft + downRight;

      const solidCore = left && right && up && down;
      const denseDiagonal = (upLeft && downRight && (left || right)) || (upRight && downLeft && (up || down));

      if (neighborCount >= 6 && (solidCore || denseDiagonal)) {
        next[idx] = 0;
      }
    }
  }
  thinned.set(next);

  return thinned;
};

const extractLockedContours = (
  contourImageData: ImageData,
  targetWidth: number,
  targetHeight: number,
): LockedContourResult => {
  const sourceWidth = contourImageData.width;
  const sourceHeight = contourImageData.height;
  const strongEdges = buildStrongEdgeMask(contourImageData, sourceWidth, sourceHeight, false);
  const darkDetails = buildDarkDetailMask(contourImageData, sourceWidth, sourceHeight);
  const featureDetails = buildFeatureDetailMask(contourImageData, sourceWidth, sourceHeight);
  const sourceMask = repairContourMask(
    mergeMasks(strongEdges, mergeMasks(darkDetails, featureDetails)),
    sourceWidth,
    sourceHeight,
  );
  const sameResolution = sourceWidth === targetWidth && sourceHeight === targetHeight;

  const mask = new Uint8Array(targetWidth * targetHeight);
  const colors = new Array<{ r: number; g: number; b: number } | null>(targetWidth * targetHeight).fill(null);
  const preserveMask = new Uint8Array(targetWidth * targetHeight);
  const { data } = contourImageData;

  for (let ty = 0; ty < targetHeight; ty++) {
    const y0 = Math.floor((ty * sourceHeight) / targetHeight);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * sourceHeight) / targetHeight));

    for (let tx = 0; tx < targetWidth; tx++) {
      const x0 = Math.floor((tx * sourceWidth) / targetWidth);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * sourceWidth) / targetWidth));
      const idx = ty * targetWidth + tx;

      let sourceHits = 0;
      let darkHits = 0;
      let featureHits = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let colorCount = 0;

      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const sourceIdx = sy * sourceWidth + sx;
          if (!sourceMask[sourceIdx]) continue;

          const p = sourceIdx * 4;
          sourceHits++;
          if (darkDetails[sourceIdx]) darkHits++;
          if (featureDetails[sourceIdx]) featureHits++;
          sumR += data[p];
          sumG += data[p + 1];
          sumB += data[p + 2];
          colorCount++;
        }
      }

      const blockArea = Math.max(1, (x1 - x0) * (y1 - y0));
      const shouldLock =
        featureHits >= 1 ||
        darkHits >= 1 ||
        sourceHits >= (sameResolution ? Math.max(2, Math.ceil(blockArea * 0.16)) : 1);

      if (!shouldLock || colorCount === 0) continue;

      mask[idx] = 1;
      if (featureHits >= 1 || darkHits >= 1) {
        preserveMask[idx] = 1;
      }
      colors[idx] = {
        r: sumR / colorCount,
        g: sumG / colorCount,
        b: sumB / colorCount,
      };
    }
  }

  const repairedMask = repairContourMask(mask, targetWidth, targetHeight);
  const thinnedMask = thinContourMask(repairedMask, preserveMask, targetWidth, targetHeight);
  for (let i = 0; i < thinnedMask.length; i++) {
    if (!thinnedMask[i] || colors[i]) continue;
    const x = i % targetWidth;
    const y = Math.floor(i / targetWidth);
    const samples: { r: number; g: number; b: number }[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= targetWidth || ny >= targetHeight) continue;
        const neighbor = colors[ny * targetWidth + nx];
        if (neighbor) samples.push(neighbor);
      }
    }
    if (samples.length === 0) continue;
    const total = samples.reduce(
      (acc, sample) => ({ r: acc.r + sample.r, g: acc.g + sample.g, b: acc.b + sample.b }),
      { r: 0, g: 0, b: 0 },
    );
    colors[i] = {
      r: total.r / samples.length,
      g: total.g / samples.length,
      b: total.b / samples.length,
    };
  }

  return { mask: thinnedMask, colors };
};

const collectOpaquePoints = (imageData: ImageData, width: number, height: number): PixelPoint[] => {
  const { data } = imageData;
  const points: PixelPoint[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] < 128) continue;
      const rgb = { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
      points.push({
        index: y * width + x,
        x,
        y,
        rgb,
        lab: rgbToLab(rgb.r, rgb.g, rgb.b),
      });
    }
  }

  return points;
};

export const estimateRecommendedColorLimit = (
  imageData: ImageData,
  width: number,
  height: number,
): number => {
  const { data } = imageData;
  const buckets = new Map<number, number>();
  let opaquePixels = 0;

  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    if (data[idx + 3] < 128) continue;
    opaquePixels++;
    const bucket =
      ((data[idx] >> 5) << 6) |
      ((data[idx + 1] >> 5) << 3) |
      (data[idx + 2] >> 5);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }

  if (opaquePixels === 0) {
    return CLEAN_TARGET_COLORS;
  }

  const dominantBuckets = Array.from(buckets.values()).sort((a, b) => b - a);
  let cumulative = 0;
  let effectiveBucketCount = 0;
  for (const count of dominantBuckets) {
    cumulative += count;
    effectiveBucketCount++;
    if (cumulative / opaquePixels >= 0.9) break;
  }

  const edgeMask = buildStrongEdgeMask(imageData, width, height, false);
  let edgePixels = 0;
  for (const edge of edgeMask) {
    edgePixels += edge;
  }

  const edgeRatio = edgePixels / Math.max(1, opaquePixels);
  let recommendation = MIN_TARGET_COLORS;

  if (effectiveBucketCount >= 4) recommendation++;
  if (effectiveBucketCount >= 6) recommendation++;
  if (effectiveBucketCount >= 9) recommendation++;
  if (edgeRatio >= 0.08) recommendation++;

  return Math.max(MIN_TARGET_COLORS, Math.min(8, recommendation));
};

/**
 * 计算 grid 中实际使用的颜色数量
 */
export const countUniqueColorsInGrid = (grid: GridCell[][]): number => {
  const colorSet = new Set<string>();
  for (const row of grid) {
    for (const cell of row) {
      if (cell) {
        colorSet.add(cell.hex);
      }
    }
  }
  return colorSet.size;
};

const createPointIndex = (points: PixelPoint[], width: number, height: number): Array<PixelPoint | null> => {
  const pointIndex = new Array<PixelPoint | null>(width * height).fill(null);
  for (const point of points) {
    pointIndex[point.index] = point;
  }
  return pointIndex;
};

const legacyNearestProcess = (
  imageData: ImageData,
  width: number,
  height: number,
  palette: Color[],
  options?: ProcessImageOptions,
): GridCell[][] => {
  const targetColors = options?.targetColors ?? palette.length;
  const applyOutline = options?.applyOutline ?? false;
  const outlineThickness = options?.outlineThickness ?? 1;

  // 只有当 targetColors 小于调色板数量时，才限制颜色
  // 默认情况下使用完整调色板，追求最还原的效果
  const useLimitedPalette = targetColors < palette.length;

  const { data } = imageData;

  // 如果需要限制颜色数量，先分析颜色频率
  let effectivePalette = palette;
  if (useLimitedPalette) {
    const colorFrequency = new Map<string, { count: number; rgb: { r: number; g: number; b: number } }>();
    let opaquePixels = 0;

    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      if (data[idx + 3] < 128) continue;
      opaquePixels++;
      const rgb = { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
      const nearest = findNearestColor(rgb, palette);
      const stat = colorFrequency.get(nearest.hex) ?? { count: 0, rgb: { r: 0, g: 0, b: 0 } };
      stat.count++;
      stat.rgb.r += rgb.r;
      stat.rgb.g += rgb.g;
      stat.rgb.b += rgb.b;
      colorFrequency.set(nearest.hex, stat);
    }

    // 按频率排序，选择最常用的颜色
    const sortedColors = Array.from(colorFrequency.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, Math.min(targetColors, palette.length))
      .map((entry) => palette.find((c) => c.hex === entry[0])!);

    effectivePalette = sortedColors.length > 0 ? sortedColors : palette;
  }

  const grid = makeGrid(width, height);
  const isEdge = new Uint8Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      const rightIdx = idx + 4;
      const downIdx = idx + (width * 4);
      const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      const grayR = (data[rightIdx] + data[rightIdx + 1] + data[rightIdx + 2]) / 3;
      const grayD = (data[downIdx] + data[downIdx + 1] + data[downIdx + 2]) / 3;
      if (Math.abs(gray - grayR) > 30 || Math.abs(gray - grayD) > 30) {
        isEdge[y * width + x] = 1;
      }
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] < 128) {
        grid[y][x] = null;
        continue;
      }
      grid[y][x] = findNearestColor({ r: data[idx], g: data[idx + 1], b: data[idx + 2] }, effectivePalette);
    }
  }

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (isEdge[y * width + x]) continue;
      const current = grid[y][x];
      if (!current) continue;

      const neighbors = [
        grid[y - 1][x - 1], grid[y - 1][x], grid[y - 1][x + 1],
        grid[y][x - 1], grid[y][x + 1],
        grid[y + 1][x - 1], grid[y + 1][x], grid[y + 1][x + 1],
      ];

      const counts = new Map<string, number>();
      for (const neighbor of neighbors) {
        if (!neighbor) continue;
        counts.set(neighbor.hex, (counts.get(neighbor.hex) ?? 0) + 1);
      }

      for (const [hex, count] of counts.entries()) {
        if (count >= 6 && current.hex !== hex) {
          const replacement = effectivePalette.find((color) => color.hex === hex);
          if (replacement) {
            grid[y][x] = replacement;
          }
          break;
        }
      }
    }
  }

  // 如果启用了黑色描边，应用描边效果
  if (applyOutline && outlineThickness >= 1) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = grid[y][x];
        if (!cell) continue;

        // 检查是否有透明邻居（边缘）或者基于梯度的边缘
        let isEdgeCell = false;

        // 检查透明邻居
        for (let dy = -outlineThickness; dy <= outlineThickness; dy++) {
          for (let dx = -outlineThickness; dx <= outlineThickness; dx++) {
            if (dx === 0 && dy === 0) continue;
            const ny = y + dy;
            const nx = x + dx;
            if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
              if (!grid[ny][nx]) {
                isEdgeCell = true;
                break;
              }
            } else {
              // 边界外的单元格也视为透明
              isEdgeCell = true;
              break;
            }
          }
          if (isEdgeCell) break;
        }

        // 如果没有透明邻居，检查是否是基于梯度的边缘
        if (!isEdgeCell && isEdge[y * width + x] === 1) {
          isEdgeCell = true;
        }

        if (isEdgeCell) {
          grid[y][x] = { name: 'Black', hex: '#000000', rgb: { r: 0, g: 0, b: 0 } };
        }
      }
    }
  }

  return grid;
};

const buildRegions = (
  pointIndex: Array<PixelPoint | null>,
  protectedMask: Uint8Array,
  width: number,
  height: number,
): Region[] => {
  const visited = new Uint8Array(width * height);
  const regions: Region[] = [];
  const directions = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
  ] as const;

  for (let idx = 0; idx < pointIndex.length; idx++) {
    const seed = pointIndex[idx];
    if (!seed || visited[idx] || protectedMask[idx]) continue;

    visited[idx] = 1;
    const queue = [idx];
    const pixels: number[] = [];
    let sumL = 0;
    let sumA = 0;
    let sumB = 0;

    while (queue.length > 0) {
      const currentIdx = queue.pop() as number;
      const point = pointIndex[currentIdx];
      if (!point) continue;

      pixels.push(currentIdx);
      sumL += point.lab.l;
      sumA += point.lab.a;
      sumB += point.lab.b;

      const currentAverage = {
        l: sumL / pixels.length,
        a: sumA / pixels.length,
        b: sumB / pixels.length,
      };

      const x = currentIdx % width;
      const y = Math.floor(currentIdx / width);
      for (const [dx, dy] of directions) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighborIdx = ny * width + nx;
        if (visited[neighborIdx] || protectedMask[neighborIdx]) continue;

        const neighbor = pointIndex[neighborIdx];
        if (!neighbor) continue;
        if (deltaE(neighbor.lab, seed.lab) > REGION_SEED_THRESHOLD) continue;
        if (deltaE(neighbor.lab, currentAverage) > REGION_AVERAGE_THRESHOLD) continue;

        visited[neighborIdx] = 1;
        queue.push(neighborIdx);
      }
    }

    if (pixels.length === 0) continue;
    regions.push({
      pixels,
      averageLab: {
        l: sumL / pixels.length,
        a: sumA / pixels.length,
        b: sumB / pixels.length,
      },
      weight: pixels.length,
    });
  }

  return regions;
};

const collectPalettePool = (
  grid: GridCell[][],
  protectedMask: Uint8Array,
  palette: Color[],
): Color[] => {
  const counts = new Map<string, { color: Color; count: number }>();
  const width = grid[0]?.length ?? 0;

  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (protectedMask[idx]) continue;
      const cell = grid[y][x];
      if (!cell) continue;
      const entry = counts.get(cell.hex);
      if (entry) {
        entry.count++;
      } else {
        counts.set(cell.hex, { color: cell, count: 1 });
      }
    }
  }

  const pool = Array.from(counts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 48)
    .map((entry) => entry.color);

  return pool.length > 0 ? pool : palette;
};

const collectContourPalette = (palette: Color[]): Color[] => {
  const contourColors = palette.filter((color) => {
    const brightness = (color.rgb.r * 299 + color.rgb.g * 587 + color.rgb.b * 114) / 1000;
    const chroma = Math.max(color.rgb.r, color.rgb.g, color.rgb.b) - Math.min(color.rgb.r, color.rgb.g, color.rgb.b);
    return brightness <= 150 && chroma <= 70;
  });
  return contourColors.length > 0 ? contourColors : palette;
};

const denoiseGrid = (
  grid: GridCell[][],
  protectedMask: Uint8Array,
  width: number,
  height: number,
): void => {
  for (let pass = 0; pass < 2; pass++) {
    const next = grid.map((row) => row.slice());
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (protectedMask[idx]) continue;
        const current = grid[y][x];
        if (!current) continue;

        const counts = new Map<string, { color: Color; count: number }>();
        let currentCount = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const neighbor = grid[y + dy][x + dx];
            if (!neighbor) continue;
            if (neighbor.hex === current.hex) {
              currentCount++;
            }
            const entry = counts.get(neighbor.hex);
            if (entry) {
              entry.count++;
            } else {
              counts.set(neighbor.hex, { color: neighbor, count: 1 });
            }
          }
        }

        const dominant = Array.from(counts.values()).sort((a, b) => b.count - a.count)[0];
        if (!dominant) continue;
        if (dominant.color.hex === current.hex) continue;
        if (dominant.count >= 5 && currentCount <= 2) {
          next[y][x] = dominant.color;
        }
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        grid[y][x] = next[y][x];
      }
    }
  }
};

const pickLegacyCleanPalette = (
  grid: GridCell[][],
  protectedMask: Uint8Array,
  brightDetails: Uint8Array,
  targetColors: number,
): Color[] => {
  const width = grid[0]?.length ?? 0;
  const allCounts = new Map<string, { color: Color; count: number; brightness: number; lab: LabColor }>();
  const protectedCounts = new Map<string, { color: Color; count: number; brightness: number; lab: LabColor }>();
  const brightCounts = new Map<string, { color: Color; count: number; brightness: number; lab: LabColor }>();

  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const cell = grid[y][x];
      if (!cell) continue;
      const brightness = (cell.rgb.r * 299 + cell.rgb.g * 587 + cell.rgb.b * 114) / 1000;
      const lab = rgbToLab(cell.rgb.r, cell.rgb.g, cell.rgb.b);

      const updateMap = (map: Map<string, { color: Color; count: number; brightness: number; lab: LabColor }>) => {
        const entry = map.get(cell.hex);
        if (entry) {
          entry.count++;
        } else {
          map.set(cell.hex, { color: cell, count: 1, brightness, lab });
        }
      };

      updateMap(allCounts);
      if (protectedMask[idx]) {
        updateMap(protectedCounts);
      }
      if (brightDetails[idx]) {
        updateMap(brightCounts);
      }
    }
  }

  const protectedSlots = Math.min(CLEAN_PROTECTED_COLOR_SLOTS, targetColors);
  const keep: Color[] = [];
  const keepHex = new Set<string>();
  const addColor = (color: Color | undefined) => {
    if (!color || keepHex.has(color.hex) || keep.length >= targetColors) return;
    keep.push(color);
    keepHex.add(color.hex);
  };
  const distinctEnough = (lab: LabColor) =>
    keep.every((color) => deltaE(lab, rgbToLab(color.rgb.r, color.rgb.g, color.rgb.b)) >= 7);

  const brightHighlight = Array.from(brightCounts.values()).sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return b.brightness - a.brightness;
  })[0];
  if (brightHighlight && brightHighlight.brightness >= 226) {
    addColor(brightHighlight.color);
  }

  const protectedColors = Array.from(protectedCounts.values()).sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return a.brightness - b.brightness;
  });
  for (const entry of protectedColors) {
    if (keep.length >= protectedSlots + (brightHighlight ? 1 : 0)) break;
    addColor(entry.color);
  }

  const dominantColors = Array.from(allCounts.values()).sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return a.brightness - b.brightness;
  });
  for (const entry of dominantColors) {
    if (keep.length >= targetColors) break;
    if (keepHex.has(entry.color.hex)) continue;
    if (!distinctEnough(entry.lab) && keep.length + 1 < targetColors) continue;
    addColor(entry.color);
  }

  return keep;
};

const remapGridToPalette = (
  grid: GridCell[][],
  keep: Color[],
  protectedMask: Uint8Array,
  width: number,
  height: number,
): void => {
  if (keep.length === 0) return;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = grid[y][x];
      if (!cell) continue;
      const idx = y * width + x;
      if (protectedMask[idx]) {
        grid[y][x] = findNearestColor(cell.rgb, keep);
        continue;
      }
      grid[y][x] = findNearestColor(cell.rgb, keep);
    }
  }
};

const compressMaskedColors = (
  grid: GridCell[][],
  mask: Uint8Array,
  maxColors: number,
  prioritizeDark: boolean,
): void => {
  const width = grid[0]?.length ?? 0;
  const counts = new Map<string, { color: Color; count: number; brightness: number }>();

  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!mask[idx]) continue;
      const cell = grid[y][x];
      if (!cell) continue;
      const brightness = (cell.rgb.r * 299 + cell.rgb.g * 587 + cell.rgb.b * 114) / 1000;
      const entry = counts.get(cell.hex);
      if (entry) {
        entry.count++;
      } else {
        counts.set(cell.hex, { color: cell, count: 1, brightness });
      }
    }
  }

  if (counts.size <= maxColors) return;

  const sorted = Array.from(counts.values()).sort((a, b) => {
    if (a.count !== b.count) {
      return b.count - a.count;
    }
    if (prioritizeDark && a.brightness !== b.brightness) {
      return a.brightness - b.brightness;
    }
    return a.brightness - b.brightness;
  });

  const keep = sorted
    .slice(0, maxColors)
    .map((entry) => entry.color);
  const keepHex = new Set(keep.map((color) => color.hex));

  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!mask[idx]) continue;
      const cell = grid[y][x];
      if (!cell || keepHex.has(cell.hex)) continue;
      grid[y][x] = findNearestColor(cell.rgb, keep);
    }
  }
};

const compressGridToPalette = (
  grid: GridCell[][],
  pointIndex: Array<PixelPoint | null>,
  targetColors: number,
  strongEdges: Uint8Array,
  darkDetails: Uint8Array,
  featureDetails: Uint8Array,
  lockedContourMask: Uint8Array,
): void => {
  const width = grid[0]?.length ?? 0;
  const allCounts = new Map<string, ColorStats>();
  const priorityDetails = new Map<string, ColorStats>();
  const edgeColors = new Map<string, ColorStats>();

  const lockedColors = new Set<string>();
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!lockedContourMask[idx]) continue;
      const cell = grid[y][x];
      if (cell) {
        lockedColors.add(cell.hex);
      }
    }
  }

  const availableColors = Math.max(1, targetColors - lockedColors.size);

  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (lockedContourMask[idx]) continue;
      const cell = grid[y][x];
      if (!cell) continue;

      const point = pointIndex[idx];
      const lab = point?.lab ?? rgbToLab(cell.rgb.r, cell.rgb.g, cell.rgb.b);
      const brightness = (cell.rgb.r * 299 + cell.rgb.g * 587 + cell.rgb.b * 114) / 1000;
      const chroma = Math.hypot(cell.rgb.r - cell.rgb.g, cell.rgb.g - cell.rgb.b, cell.rgb.b - cell.rgb.r);
      const isBackground = lab.l >= 95 && chroma <= 20;

      const updateMap = (map: Map<string, ColorStats>) => {
        const entry = map.get(cell.hex);
        if (entry) {
          entry.count++;
          entry.sumLab.l += lab.l;
          entry.sumLab.a += lab.a;
          entry.sumLab.b += lab.b;
          if (strongEdges[idx]) entry.edgeCount++;
          if (darkDetails[idx]) entry.darkDetailCount++;
          if (featureDetails[idx]) entry.featureCount++;
          if (isBackground) entry.backgroundCount++;
          return;
        }

        map.set(cell.hex, {
          color: cell,
          count: 1,
          brightness,
          chroma,
          sumLab: { ...lab },
          edgeCount: strongEdges[idx] ? 1 : 0,
          darkDetailCount: darkDetails[idx] ? 1 : 0,
          featureCount: featureDetails[idx] ? 1 : 0,
          backgroundCount: isBackground ? 1 : 0,
        });
      };

      updateMap(allCounts);
      if (featureDetails[idx] || darkDetails[idx]) {
        updateMap(priorityDetails);
      }
      if (strongEdges[idx] || darkDetails[idx]) {
        updateMap(edgeColors);
      }
    }
  }

  if (allCounts.size <= availableColors) return;

  const getAverageLab = (entry: ColorStats): LabColor => ({
    l: entry.sumLab.l / entry.count,
    a: entry.sumLab.a / entry.count,
    b: entry.sumLab.b / entry.count,
  });

  const keep: Color[] = [];
  const keepHex = new Set<string>();
  const addColor = (color: Color | undefined) => {
    if (!color || keepHex.has(color.hex) || keep.length >= availableColors) return;
    keep.push(color);
    keepHex.add(color.hex);
  };

  const isDistinctEnough = (entry: ColorStats) => keep.every((color) => {
    const keepLab = rgbToLab(color.rgb.r, color.rgb.g, color.rgb.b);
    return deltaE(getAverageLab(entry), keepLab) >= 8;
  });

  const background = Array.from(allCounts.values())
    .filter((entry) => entry.backgroundCount > 0)
    .sort((a, b) => b.backgroundCount - a.backgroundCount)[0];
  addColor(background?.color);

  const outline = Array.from(edgeColors.values()).sort((a, b) => {
    if (a.darkDetailCount !== b.darkDetailCount) return b.darkDetailCount - a.darkDetailCount;
    if (a.edgeCount !== b.edgeCount) return b.edgeCount - a.edgeCount;
    return a.brightness - b.brightness;
  })[0];
  addColor(outline?.color);

  const featureAccent = Array.from(priorityDetails.values())
    .filter((entry) => entry.featureCount > 0 && entry.brightness > (outline?.brightness ?? 0) + 10)
    .sort((a, b) => {
      if (a.featureCount !== b.featureCount) return b.featureCount - a.featureCount;
      return a.brightness - b.brightness;
    })[0];
  addColor(featureAccent?.color);

  const dominant = Array.from(allCounts.values()).sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return a.brightness - b.brightness;
  });

  for (const entry of dominant) {
    if (keep.length >= availableColors) break;
    if (keepHex.has(entry.color.hex)) continue;
    if (!isDistinctEnough(entry) && keep.length + 1 < availableColors) continue;
    addColor(entry.color);
  }

  const edgePalette = Array.from(edgeColors.values())
    .sort((a, b) => {
      const aWeight = (a.edgeCount * 2) + (a.darkDetailCount * 3) + a.featureCount;
      const bWeight = (b.edgeCount * 2) + (b.darkDetailCount * 3) + b.featureCount;
      if (aWeight !== bWeight) return bWeight - aWeight;
      return a.brightness - b.brightness;
    })
    .map((entry) => entry.color)
    .filter((color, index, array) => array.findIndex((entry) => entry.hex === color.hex) === index)
    .slice(0, GUIDED_EDGE_PALETTE_SIZE);

  const detailPalette = [
    featureAccent?.color,
    outline?.color,
    ...edgePalette,
  ].filter((color, index, array): color is Color => Boolean(color) && array.findIndex((entry) => entry?.hex === color?.hex) === index);

  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (lockedContourMask[idx]) continue;
      const cell = grid[y][x];
      if (!cell) continue;

      const point = pointIndex[idx];
      const rgb = point?.rgb ?? cell.rgb;
      const lab = point?.lab ?? rgbToLab(rgb.r, rgb.g, rgb.b);

      if (featureDetails[idx] && detailPalette.length > 0) {
        grid[y][x] = findNearestColor(rgb, detailPalette);
        continue;
      }

      if ((strongEdges[idx] || darkDetails[idx]) && edgePalette.length > 0) {
        grid[y][x] = findNearestColor(rgb, edgePalette);
        continue;
      }

      if (background && lab.l >= 95 && keepHex.has(background.color.hex)) {
        grid[y][x] = background.color;
        continue;
      }

      grid[y][x] = findNearestColor(rgb, keep);
    }
  }
};

const isNearBlackInk = (r: number, g: number, b: number, threshold: number): boolean => {
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  const normalized = Math.max(0, Math.min(100, threshold));
  const brightnessLimit = 52 + (normalized * 0.9);
  const chromaLimit = 18 + (normalized * 0.72);
  return brightness <= brightnessLimit && chroma <= chromaLimit;
};

const extractInkOutlineMask = (
  contourImageData: ImageData,
  targetWidth: number,
  targetHeight: number,
  threshold: number,
): Uint8Array => {
  const sourceWidth = contourImageData.width;
  const sourceHeight = contourImageData.height;
  const { data } = contourImageData;
  const sourceMask = new Uint8Array(sourceWidth * sourceHeight);

  for (let i = 0; i < sourceMask.length; i++) {
    const p = i * 4;
    if (data[p + 3] < 128) continue;
    if (isNearBlackInk(data[p], data[p + 1], data[p + 2], threshold)) {
      sourceMask[i] = 1;
    }
  }

  // Strip isolated dark noise from the high-res contour source before downsampling.
  for (let y = 1; y < sourceHeight - 1; y++) {
    for (let x = 1; x < sourceWidth - 1; x++) {
      const idx = y * sourceWidth + x;
      if (!sourceMask[idx]) continue;
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          neighbors += sourceMask[(y + dy) * sourceWidth + (x + dx)];
        }
      }
      if (neighbors === 0) {
        sourceMask[idx] = 0;
      }
    }
  }

  const downsampled = new Uint8Array(targetWidth * targetHeight);
  const normalized = Math.max(0, Math.min(100, threshold));
  const hitRatio = 0.14 - (normalized * 0.001);
  const minHitRatio = Math.max(0.04, Math.min(0.16, hitRatio));
  for (let ty = 0; ty < targetHeight; ty++) {
    const y0 = Math.floor((ty * sourceHeight) / targetHeight);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * sourceHeight) / targetHeight));
    for (let tx = 0; tx < targetWidth; tx++) {
      const x0 = Math.floor((tx * sourceWidth) / targetWidth);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * sourceWidth) / targetWidth));
      const blockArea = Math.max(1, (x1 - x0) * (y1 - y0));
      const hitThreshold = Math.max(1, Math.ceil(blockArea * minHitRatio));
      let hits = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          hits += sourceMask[sy * sourceWidth + sx];
        }
      }
      if (hits >= hitThreshold) {
        downsampled[ty * targetWidth + tx] = 1;
      }
    }
  }

  const repaired = repairContourMask(downsampled, targetWidth, targetHeight);
  return thinContourMask(repaired, new Uint8Array(repaired.length), targetWidth, targetHeight);
};

const pickInkOutlineColor = (palette: Color[]): Color => {
  const ranked = palette
    .map((color) => {
      const brightness = (color.rgb.r * 299 + color.rgb.g * 587 + color.rgb.b * 114) / 1000;
      const chroma = Math.max(color.rgb.r, color.rgb.g, color.rgb.b) - Math.min(color.rgb.r, color.rgb.g, color.rgb.b);
      return { color, brightness, chroma };
    })
    .sort((a, b) => {
      if (a.brightness !== b.brightness) return a.brightness - b.brightness;
      return a.chroma - b.chroma;
    });

  const strict = ranked.find((entry) => entry.brightness <= 70 && entry.chroma <= 40);
  return strict?.color ?? ranked[0].color;
};

const runInkOutlineFill = (
  imageData: ImageData,
  width: number,
  height: number,
  palette: Color[],
  options?: ProcessImageOptions,
): GridCell[][] => {
  const source = options?.contourImageData ?? imageData;
  const targetColors = clampTargetColors(options?.targetColors ?? GUIDED_TOTAL_MAX_COLORS);
  const contourThreshold = Math.max(0, Math.min(100, options?.contourThreshold ?? 50));
  const outlineMask = extractInkOutlineMask(source, width, height, contourThreshold);
  const outlineColor = pickInkOutlineColor(palette);
  const fillPalette = palette.filter((color) => color.hex !== outlineColor.hex);
  const effectiveFillPalette = fillPalette.length > 0 ? fillPalette : palette;
  const grid = makeGrid(width, height);
  const interiorMask = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);
  const { data } = imageData;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const p = idx * 4;
      if (data[p + 3] < 128) {
        grid[y][x] = null;
        continue;
      }
      if (outlineMask[idx]) {
        grid[y][x] = outlineColor;
        continue;
      }
      interiorMask[idx] = 1;
    }
  }

  const directions = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
  ] as const;

  for (let idx = 0; idx < interiorMask.length; idx++) {
    if (!interiorMask[idx] || visited[idx]) continue;
    visited[idx] = 1;
    const queue = [idx];
    const pixels: number[] = [];
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;

    while (queue.length > 0) {
      const current = queue.pop() as number;
      pixels.push(current);
      const p = current * 4;
      sumR += data[p];
      sumG += data[p + 1];
      sumB += data[p + 2];

      const x = current % width;
      const y = Math.floor(current / width);
      for (const [dx, dy] of directions) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbor = (ny * width) + nx;
        if (!interiorMask[neighbor] || visited[neighbor]) continue;
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }

    if (pixels.length === 0) continue;
    const average = {
      r: sumR / pixels.length,
      g: sumG / pixels.length,
      b: sumB / pixels.length,
    };
    const fillColor = findNearestColor(average, effectiveFillPalette);
    for (const pixel of pixels) {
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      grid[y][x] = fillColor;
    }
  }

  let outlineCount = 0;
  for (const value of outlineMask) outlineCount += value;
  const fillTargetColors = outlineCount > 0
    ? Math.max(1, targetColors - 1)
    : targetColors;
  compressMaskedColors(grid, interiorMask, fillTargetColors, false);
  return grid;
};

const initializeWeightedCenters = (samples: WeightedSample[], k: number, random: () => number): LabColor[] => {
  const centers: LabColor[] = [];
  centers.push(samples[Math.floor(random() * samples.length)].lab);

  while (centers.length < k) {
    const distances = new Float64Array(samples.length);
    let total = 0;

    for (let i = 0; i < samples.length; i++) {
      let minDistance = Number.POSITIVE_INFINITY;
      for (const center of centers) {
        const distance = squaredLabDistance(samples[i].lab, center);
        if (distance < minDistance) {
          minDistance = distance;
        }
      }
      const weightedDistance = minDistance * samples[i].weight;
      distances[i] = weightedDistance;
      total += weightedDistance;
    }

    if (total <= 0) {
      centers.push(samples[Math.floor(random() * samples.length)].lab);
      continue;
    }

    const target = random() * total;
    let cumulative = 0;
    let selected = samples.length - 1;
    for (let i = 0; i < samples.length; i++) {
      cumulative += distances[i];
      if (cumulative >= target) {
        selected = i;
        break;
      }
    }
    centers.push(samples[selected].lab);
  }

  return centers;
};

const runWeightedKMeans = (samples: WeightedSample[], k: number, random: () => number): WeightedKMeansResult => {
  const labels = new Uint16Array(samples.length);
  let centers = initializeWeightedCenters(samples, k, random);

  for (let iteration = 0; iteration < 10; iteration++) {
    let changed = false;

    for (let i = 0; i < samples.length; i++) {
      let bestIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let c = 0; c < centers.length; c++) {
        const distance = squaredLabDistance(samples[i].lab, centers[c]);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = c;
        }
      }
      if (labels[i] !== bestIndex) {
        labels[i] = bestIndex;
        changed = true;
      }
    }

    const nextCenters = Array.from({ length: k }, () => ({ l: 0, a: 0, b: 0, weight: 0 }));
    for (let i = 0; i < samples.length; i++) {
      const bucket = nextCenters[labels[i]];
      bucket.l += samples[i].lab.l * samples[i].weight;
      bucket.a += samples[i].lab.a * samples[i].weight;
      bucket.b += samples[i].lab.b * samples[i].weight;
      bucket.weight += samples[i].weight;
    }

    centers = nextCenters.map((center) => {
      if (center.weight === 0) {
        return samples[Math.floor(random() * samples.length)].lab;
      }
      return {
        l: center.l / center.weight,
        a: center.a / center.weight,
        b: center.b / center.weight,
      };
    });

    if (!changed) break;
  }

  let weightedError = 0;
  let totalWeight = 0;
  for (let i = 0; i < samples.length; i++) {
    weightedError += Math.sqrt(squaredLabDistance(samples[i].lab, centers[labels[i]])) * samples[i].weight;
    totalWeight += samples[i].weight;
  }

  return {
    labels,
    centers,
    weightedError: totalWeight > 0 ? weightedError / totalWeight : 0,
  };
};

const pickGuidedPalette = (
  regions: Region[],
  palettePool: Color[],
): Color[] => {
  if (regions.length === 0) return [];

  const poolLabs = palettePool.map((color) => rgbToLab(color.rgb.r, color.rgb.g, color.rgb.b));
  const samples: WeightedSample[] = regions.map((region) => ({ lab: region.averageLab, weight: region.weight }));
  const candidateKs = GUIDED_K_CANDIDATES.filter((k) => k <= regions.length && k <= palettePool.length);
  if (candidateKs.length === 0) {
    candidateKs.push(Math.min(regions.length, palettePool.length));
  }

  let bestColors: Color[] = [];
  let bestScore = Number.POSITIVE_INFINITY;
  let seedBase = regions.length * 8191 + palettePool.length * 131;

  for (const k of candidateKs) {
    for (let restart = 0; restart < 2; restart++) {
      const random = createSeededRandom(seedBase + (k * 97) + restart);
      const result = runWeightedKMeans(samples, k, random);
      const unique = new Map<string, Color>();

      for (const center of result.centers) {
        let bestIndex = 0;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let i = 0; i < poolLabs.length; i++) {
          const distance = squaredLabDistance(center, poolLabs[i]);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = i;
          }
        }
        unique.set(palettePool[bestIndex].hex, palettePool[bestIndex]);
      }

      const colors = Array.from(unique.values());
      const score = result.weightedError + Math.max(0, colors.length - 24) * 0.4;
      if (result.weightedError <= GUIDED_TARGET_ERROR) {
        return colors;
      }
      if (score < bestScore) {
        bestScore = score;
        bestColors = colors;
      }
    }
    seedBase += 17;
  }

  return bestColors.length > 0 ? bestColors : palettePool.slice(0, Math.min(24, palettePool.length));
};

const cleanupTinyComponents = (
  grid: GridCell[][],
  protectedMask: Uint8Array,
  width: number,
  height: number,
): void => {
  const visited = new Uint8Array(width * height);
  const directions = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
  ] as const;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const startIdx = y * width + x;
      if (visited[startIdx] || protectedMask[startIdx]) continue;

      const startColor = grid[y][x];
      if (!startColor) {
        visited[startIdx] = 1;
        continue;
      }

      const queue = [startIdx];
      const pixels: number[] = [];
      const boundary = new Map<string, { color: Color; count: number }>();
      visited[startIdx] = 1;

      while (queue.length > 0) {
        const currentIdx = queue.pop() as number;
        pixels.push(currentIdx);
        const cx = currentIdx % width;
        const cy = Math.floor(currentIdx / width);

        for (const [dx, dy] of directions) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighborIdx = ny * width + nx;
          const neighbor = grid[ny][nx];
          if (!neighbor) continue;

          if (protectedMask[neighborIdx] || neighbor.hex !== startColor.hex) {
            const entry = boundary.get(neighbor.hex);
            if (entry) {
              entry.count++;
            } else {
              boundary.set(neighbor.hex, { color: neighbor, count: 1 });
            }
            continue;
          }

          if (!visited[neighborIdx]) {
            visited[neighborIdx] = 1;
            queue.push(neighborIdx);
          }
        }
      }

      if (pixels.length > 3 || boundary.size === 0) continue;
      const replacement = Array.from(boundary.values()).sort((a, b) => b.count - a.count)[0]?.color;
      if (!replacement) continue;

      for (const pixelIdx of pixels) {
        const px = pixelIdx % width;
        const py = Math.floor(pixelIdx / width);
        grid[py][px] = replacement;
      }
    }
  }
};

const runLegacyClean = (
  imageData: ImageData,
  width: number,
  height: number,
  palette: Color[],
  options?: ProcessImageOptions,
): GridCell[][] => {
  const targetColors = clampTargetColors(options?.targetColors ?? CLEAN_TARGET_COLORS);
  const grid = legacyNearestProcess(imageData, width, height, palette);
  const strongEdges = buildStrongEdgeMask(imageData, width, height, false);
  const darkDetails = buildDarkDetailMask(imageData, width, height);
  const featureDetails = buildFeatureDetailMask(imageData, width, height);
  const brightDetails = buildBrightDetailMask(imageData, width, height);
  const protectedMask = mergeMasks(strongEdges, mergeMasks(darkDetails, mergeMasks(featureDetails, brightDetails)));

  denoiseGrid(grid, protectedMask, width, height);
  cleanupTinyComponents(grid, protectedMask, width, height);

  const keep = pickLegacyCleanPalette(grid, protectedMask, brightDetails, targetColors);
  remapGridToPalette(grid, keep, protectedMask, width, height);
  denoiseGrid(grid, protectedMask, width, height);
  cleanupTinyComponents(grid, protectedMask, width, height);

  return grid;
};

const runLegacyGuided = (
  imageData: ImageData,
  width: number,
  height: number,
  palette: Color[],
  options?: ProcessImageOptions,
): GridCell[][] => {
  const targetColors = clampTargetColors(options?.targetColors ?? GUIDED_TOTAL_MAX_COLORS);
  const lockedContourTargetColors = Math.min(GUIDED_LOCKED_CONTOUR_MAX_COLORS, targetColors);
  const protectedTargetColors = Math.min(GUIDED_PROTECTED_MAX_COLORS, targetColors);
  const baseGrid = legacyNearestProcess(imageData, width, height, palette);
  const points = collectOpaquePoints(imageData, width, height);
  if (points.length === 0) return baseGrid;

  const contourSource = options?.contourImageData ?? imageData;
  const lockedContours = extractLockedContours(contourSource, width, height);
  const lockedContourMask = lockedContours.mask;
  const strongEdges = buildStrongEdgeMask(imageData, width, height);
  const darkDetails = buildDarkDetailMask(imageData, width, height);
  const featureDetails = buildFeatureDetailMask(imageData, width, height);
  const brightDetails = buildBrightDetailMask(imageData, width, height);
  const protectedDetails = mergeMasks(darkDetails, mergeMasks(featureDetails, brightDetails));
  const protectedMask = mergeMasks(lockedContourMask, mergeMasks(strongEdges, protectedDetails));
  const pointIndex = createPointIndex(points, width, height);
  const regions = buildRegions(pointIndex, protectedMask, width, height);
  const guidedGrid = baseGrid.map((row) => row.slice());
  const contourPalette = collectContourPalette(palette);

  for (let idx = 0; idx < lockedContourMask.length; idx++) {
    if (!lockedContourMask[idx]) continue;
    const contourColor = lockedContours.colors[idx];
    if (!contourColor) continue;
    const x = idx % width;
    const y = Math.floor(idx / width);
    guidedGrid[y][x] = findNearestColor(contourColor, contourPalette);
  }

  if (regions.length === 0) {
    compressMaskedColors(guidedGrid, lockedContourMask, lockedContourTargetColors, true);
    return guidedGrid;
  }

  const palettePool = pickGuidedPalette(regions, collectPalettePool(baseGrid, protectedMask, palette));

  for (const region of regions) {
    const averageRgb = {
      r: 0,
      g: 0,
      b: 0,
    };
    for (const pixelIdx of region.pixels) {
      const point = pointIndex[pixelIdx];
      if (!point) continue;
      averageRgb.r += point.rgb.r;
      averageRgb.g += point.rgb.g;
      averageRgb.b += point.rgb.b;
    }
    averageRgb.r /= region.pixels.length;
    averageRgb.g /= region.pixels.length;
    averageRgb.b /= region.pixels.length;

    const replacement = findNearestColor(averageRgb, palettePool);
    for (const pixelIdx of region.pixels) {
      const x = pixelIdx % width;
      const y = Math.floor(pixelIdx / width);
      guidedGrid[y][x] = replacement;
    }
  }

  cleanupTinyComponents(guidedGrid, protectedMask, width, height);
  compressMaskedColors(guidedGrid, lockedContourMask, lockedContourTargetColors, true);
  compressMaskedColors(guidedGrid, protectedDetails, protectedTargetColors, true);
  compressGridToPalette(
    guidedGrid,
    pointIndex,
    targetColors,
    strongEdges,
    darkDetails,
    featureDetails,
    lockedContourMask,
  );
  return guidedGrid;
};

const compressProjectedGridToPalette = (
  projected: ReturnType<typeof projectMosaicToGrid>,
  palette: Color[],
  targetColors: number,
): GridCell[][] => {
  const colorStats = new Map<string, {
    color: Color;
    count: number;
    contour: number;
    feature: number;
  }>();

  const nearestGrid = projected.cells.map((row) => row.map((cell) => {
    if (cell.alpha === 0) {
      return null;
    }

    const nearest = findNearestColor(cell.rgb, palette);
    const stat = colorStats.get(nearest.hex) ?? {
      color: nearest,
      count: 0,
      contour: 0,
      feature: 0,
    };
    stat.count++;
    if (cell.priority === 'contour') {
      stat.contour++;
    } else if (cell.priority === 'feature') {
      stat.feature++;
    }
    colorStats.set(nearest.hex, stat);
    return nearest;
  }));

  const stats = Array.from(colorStats.values());
  const reserved = stats
    .filter((entry) => entry.contour > 0 || entry.feature > 0)
    .sort((a, b) => ((b.contour * 1000) + (b.feature * 500) + b.count) - ((a.contour * 1000) + (a.feature * 500) + a.count))
    .slice(0, Math.min(targetColors, 4))
    .map((entry) => entry.color);

  const keep = [...reserved];
  for (const entry of stats.sort((a, b) => b.count - a.count)) {
    if (keep.some((color) => color.hex === entry.color.hex)) continue;
    keep.push(entry.color);
    if (keep.length >= targetColors) {
      break;
    }
  }

  const fallbackPalette = keep.length > 0 ? keep : palette.slice(0, Math.max(1, targetColors));

  return projected.cells.map((row, y) => row.map((cell, x) => {
    if (cell.alpha === 0) {
      return null;
    }

    const direct = nearestGrid[y][x];
    if (direct && fallbackPalette.some((color) => color.hex === direct.hex)) {
      return direct;
    }

    return findNearestColor(cell.rgb, fallbackPalette);
  }));
};

export const runMultiscalePatternPipeline = (
  imageData: ImageData,
  width: number,
  height: number,
  palette: Color[],
  options?: ProcessImageOptions,
): GridCell[][] => {
  const source = options?.contourImageData ?? imageData;
  const workingResolution = Math.max(
    Math.max(width, height),
    Math.round(options?.workingResolution ?? 120),
  );
  const targetColors = clampTargetColors(options?.targetColors ?? 8);
  const featureMaps = extractFeatureMaps(source);
  const workingGrid = rasterizeWorkingGrid(source, workingResolution, workingResolution);
  const workingFeatures = renderFeatureMapsToWorkingGrid(featureMaps, workingResolution, workingResolution);
  const mosaic = buildRegionMosaic(workingGrid, workingFeatures, { mergeThreshold: 14 });
  const projected = projectMosaicToGrid(mosaic, width, height);
  return compressProjectedGridToPalette(projected, palette, targetColors);
};

export const kMeansClustering = (
  pixels: { r: number; g: number; b: number }[],
  palette: Color[],
): Color[] => pixels.map((pixel) => findNearestColor(pixel, palette));

export const processImageToGrid = (
  imageData: ImageData,
  width: number,
  height: number,
  palette: Color[],
  options?: ProcessImageOptions,
): GridCell[][] => {
  const mode: AlgorithmMode = options?.mode ?? 'legacy-clean';
  if (mode === 'legacy-nearest') {
    return legacyNearestProcess(imageData, width, height, palette, options);
  }
  if (mode === 'legacy-clean') {
    return runLegacyClean(imageData, width, height, palette, options);
  }
  if (mode === 'legacy-guided') {
    return runLegacyGuided(imageData, width, height, palette, options);
  }
  if (mode === 'contour-locked') {
    return runMultiscalePatternPipeline(imageData, width, height, palette, options);
  }
  if (mode === 'ink-outline-fill') {
    return runInkOutlineFill(imageData, width, height, palette, options);
  }
  if (mode === 'black-outline') {
    return runBlackOutline(imageData, width, height, palette, options);
  }
  return runLegacyGuided(imageData, width, height, palette, options);
};

/**
 * 黑色描边模式 - 先为图像添加黑色轮廓，然后进行填色处理
 */
const runBlackOutline = (
  imageData: ImageData,
  width: number,
  height: number,
  palette: Color[],
  options?: ProcessImageOptions,
): GridCell[][] => {
  const targetColors = clampTargetColors(options?.targetColors ?? GUIDED_TOTAL_MAX_COLORS);
  const applyOutline = options?.applyOutline ?? false;
  const outlineThickness = options?.outlineThickness ?? 1;

  // 根据选项决定是否应用黑色描边
  const processedImageData = applyOutline
    ? applyBlackOutlineToImageData(imageData, outlineThickness)
    : imageData;

  // 创建网格
  const grid = makeGrid(width, height);
  const { data } = processedImageData;

  // 将图像数据转换为网格
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];

      if (alpha < 128) {
        grid[y][x] = null;
        continue;
      }

      const rgb = { r: data[idx], g: data[idx + 1], b: data[idx + 2] };

      // 如果是黑色（描边部分），直接使用黑色
      if (rgb.r < 50 && rgb.g < 50 && rgb.b < 50) {
        grid[y][x] = {
          name: 'Black',
          hex: '#000000',
          rgb: { r: 0, g: 0, b: 0 }
        };
      } else {
        // 否则使用最近的颜色
        grid[y][x] = findNearestColor(rgb, palette);
      }
    }
  }

  // 创建内部掩码（非黑色区域）
  const interiorMask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const cell = grid[y][x];
      if (cell && !(cell.rgb.r === 0 && cell.rgb.g === 0 && cell.rgb.b === 0)) {
        interiorMask[idx] = 1;
      }
    }
  }

  // 压缩内部颜色
  const fillTargetColors = applyOutline ? Math.max(1, targetColors - 1) : targetColors;
  compressMaskedColors(grid, interiorMask, fillTargetColors, false);

  return grid;
};

export const __testOnly = {
  buildStrongEdgeMask,
  buildDarkDetailMask,
  buildFeatureDetailMask,
  buildBrightDetailMask,
  extractLockedContours,
};
