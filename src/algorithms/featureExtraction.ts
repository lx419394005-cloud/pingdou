import { deltaE, rgbToLab, type LabColor } from '../utils/colorUtils';

export interface FeatureMaps {
  width: number;
  height: number;
  strongEdges: Uint8Array;
  darkDetails: Uint8Array;
  brightDetails: Uint8Array;
  featureDetails: Uint8Array;
  featurePriority: Uint8Array;
}

const mergeMasks = (primary: Uint8Array, secondary: Uint8Array): Uint8Array => {
  const merged = new Uint8Array(primary.length);
  for (let i = 0; i < primary.length; i++) {
    merged[i] = (primary[i] || secondary[i]) ? 1 : 0;
  }
  return merged;
};

const expandSmallComponents = (
  baseMask: Uint8Array,
  candidate: Uint8Array,
  width: number,
  height: number,
  maxComponentSize: number,
) => {
  const next = baseMask.slice();
  const visited = new Uint8Array(candidate.length);
  const directions = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
  ] as const;

  for (let idx = 0; idx < candidate.length; idx++) {
    if (!candidate[idx] || visited[idx]) continue;

    visited[idx] = 1;
    const queue = [idx];
    const component: number[] = [];
    let touchesBorder = false;

    while (queue.length > 0) {
      const current = queue.pop() as number;
      component.push(current);
      const x = current % width;
      const y = Math.floor(current / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        touchesBorder = true;
      }

      for (const [dx, dy] of directions) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighborIdx = (ny * width) + nx;
        if (candidate[neighborIdx] && !visited[neighborIdx]) {
          visited[neighborIdx] = 1;
          queue.push(neighborIdx);
        }
      }
    }

    if (!touchesBorder && component.length <= maxComponentSize) {
      for (const pixelIdx of component) {
        next[pixelIdx] = 1;
      }
    }
  }

  return next;
};

export const buildStrongEdgeMask = (
  imageData: ImageData,
  width = imageData.width,
  height = imageData.height,
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
        (chromaWeight * ((gxA * gxA) + (gyA * gyA) + (gxB * gxB) + (gyB * gyB))),
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
        if (!mask[neighborIdx] && magnitudesArray[neighborIdx] >= low) {
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

export const buildDarkDetailMask = (
  imageData: ImageData,
  width = imageData.width,
  height = imageData.height,
): Uint8Array => {
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
  const darkThreshold = Math.min(120, p15 + 28);
  const mask = new Uint8Array(width * height);
  const darkCandidates = new Uint8Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (data[(idx * 4) + 3] < 128) continue;

      const center = luminance[idx];
      if (center <= 82) {
        darkCandidates[idx] = 1;
      }
      if (center > darkThreshold) continue;

      const neighbors = [
        luminance[idx - width - 1],
        luminance[idx - width],
        luminance[idx - width + 1],
        luminance[idx - 1],
        luminance[idx + 1],
        luminance[idx + width - 1],
        luminance[idx + width],
        luminance[idx + width + 1],
      ];
      const brighterNeighbors = neighbors.filter((value) => value - center >= 10).length;
      const minNeighbor = Math.min(...neighbors);
      const maxNeighbor = Math.max(...neighbors);
      const horizontalBridge = (luminance[idx - 1] - center >= 8) && (luminance[idx + 1] - center >= 8);
      const verticalBridge = (luminance[idx - width] - center >= 8) && (luminance[idx + width] - center >= 8);
      const localMinimum = center <= (minNeighbor + 3);

      if ((horizontalBridge || verticalBridge || brighterNeighbors >= 3) && localMinimum && (maxNeighbor - center >= 10)) {
        mask[idx] = 1;
      }
    }
  }

  return expandSmallComponents(mask, darkCandidates, width, height, Math.max(12, Math.floor((width * height) * 0.025)));
};

export const buildFeatureDetailMask = (
  imageData: ImageData,
  width = imageData.width,
  height = imageData.height,
): Uint8Array => {
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
        ((horizontalContrast >= 8 && Math.abs(centerChroma - horizontalChroma) >= 4) ||
          (horizontalContrast >= 6 && horizontalDarkening >= 4));
      const hasVerticalFeature =
        verticalBridge &&
        ((verticalContrast >= 8 && Math.abs(centerChroma - verticalChroma) >= 4) ||
          (verticalContrast >= 6 && verticalDarkening >= 4));

      if (hasHorizontalFeature || hasVerticalFeature) {
        mask[idx] = 1;
      }
    }
  }

  return mask;
};

export const buildBrightDetailMask = (
  imageData: ImageData,
  width = imageData.width,
  height = imageData.height,
): Uint8Array => {
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
  const brightThreshold = Math.max(215, p85 + 2);
  const mask = new Uint8Array(width * height);
  const brightCandidates = new Uint8Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (data[(idx * 4) + 3] < 128) continue;

      const center = luminance[idx];
      if (center >= 245) {
        brightCandidates[idx] = 1;
      }
      if (center < brightThreshold) continue;

      const neighbors = [
        luminance[idx - width - 1],
        luminance[idx - width],
        luminance[idx - width + 1],
        luminance[idx - 1],
        luminance[idx + 1],
        luminance[idx + width - 1],
        luminance[idx + width],
        luminance[idx + width + 1],
      ];
      const darkerNeighbors = neighbors.filter((value) => center - value >= 10).length;
      const horizontalPocket = (center - luminance[idx - 1] >= 10) && (center - luminance[idx + 1] >= 10);
      const verticalPocket = (center - luminance[idx - width] >= 10) && (center - luminance[idx + width] >= 10);
      const localMaximum = center >= Math.max(...neighbors) - 2;

      if (localMaximum && darkerNeighbors >= 3 && (horizontalPocket || verticalPocket || darkerNeighbors >= 5)) {
        mask[idx] = 1;
      }
    }
  }

  return expandSmallComponents(mask, brightCandidates, width, height, Math.max(12, Math.floor((width * height) * 0.02)));
};

export const extractFeatureMaps = (imageData: ImageData): FeatureMaps => {
  const width = imageData.width;
  const height = imageData.height;
  const strongEdges = buildStrongEdgeMask(imageData, width, height);
  const darkDetails = buildDarkDetailMask(imageData, width, height);
  const brightDetails = buildBrightDetailMask(imageData, width, height);
  const featureDetails = mergeMasks(buildFeatureDetailMask(imageData, width, height), brightDetails);
  const featurePriority = mergeMasks(strongEdges, mergeMasks(darkDetails, featureDetails));

  return {
    width,
    height,
    strongEdges,
    darkDetails,
    brightDetails,
    featureDetails,
    featurePriority,
  };
};
