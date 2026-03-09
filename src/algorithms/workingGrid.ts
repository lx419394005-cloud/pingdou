import type { FeatureMaps } from './featureExtraction';

export interface WorkingGrid {
  width: number;
  height: number;
  imageData: ImageData;
  alphaMask: Uint8Array;
  sourceWidth: number;
  sourceHeight: number;
}

const getBlockBounds = (index: number, targetSize: number, sourceSize: number) => {
  const start = Math.floor((index * sourceSize) / targetSize);
  const end = Math.max(start + 1, Math.floor(((index + 1) * sourceSize) / targetSize));
  return { start, end };
};

const downsampleMask = (mask: Uint8Array, sourceWidth: number, sourceHeight: number, width: number, height: number) => {
  const next = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    const { start: y0, end: y1 } = getBlockBounds(y, height, sourceHeight);
    for (let x = 0; x < width; x++) {
      const { start: x0, end: x1 } = getBlockBounds(x, width, sourceWidth);
      let hits = 0;
      const area = Math.max(1, (x1 - x0) * (y1 - y0));
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          hits += mask[(sy * sourceWidth) + sx];
        }
      }
      if (hits >= Math.max(1, Math.ceil(area * 0.15))) {
        next[(y * width) + x] = 1;
      }
    }
  }

  return next;
};

export const rasterizeWorkingGrid = (sourceImageData: ImageData, width: number, height: number): WorkingGrid => {
  const data = new Uint8ClampedArray(width * height * 4);
  const alphaMask = new Uint8Array(width * height);
  const sourceWidth = sourceImageData.width;
  const sourceHeight = sourceImageData.height;
  const source = sourceImageData.data;

  for (let y = 0; y < height; y++) {
    const { start: y0, end: y1 } = getBlockBounds(y, height, sourceHeight);
    for (let x = 0; x < width; x++) {
      const { start: x0, end: x1 } = getBlockBounds(x, width, sourceWidth);
      let sumA = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let count = 0;

      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const sourceIdx = ((sy * sourceWidth) + sx) * 4;
          const alpha = source[sourceIdx + 3];
          if (alpha === 0) continue;
          sumA += alpha;
          sumR += source[sourceIdx] * alpha;
          sumG += source[sourceIdx + 1] * alpha;
          sumB += source[sourceIdx + 2] * alpha;
          count++;
        }
      }

      const idx = ((y * width) + x) * 4;
      if (sumA === 0 || count === 0) {
        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
        data[idx + 3] = 0;
        continue;
      }

      const averageAlpha = Math.round(sumA / count);
      data[idx] = Math.round(sumR / sumA);
      data[idx + 1] = Math.round(sumG / sumA);
      data[idx + 2] = Math.round(sumB / sumA);
      data[idx + 3] = averageAlpha;
      alphaMask[(y * width) + x] = averageAlpha >= 128 ? 1 : 0;
    }
  }

  return {
    width,
    height,
    imageData: { width, height, data } as ImageData,
    alphaMask,
    sourceWidth,
    sourceHeight,
  };
};

export const renderFeatureMapsToWorkingGrid = (
  featureMaps: FeatureMaps,
  width: number,
  height: number,
): FeatureMaps => {
  const strongEdges = downsampleMask(featureMaps.strongEdges, featureMaps.width, featureMaps.height, width, height);
  const darkDetails = downsampleMask(featureMaps.darkDetails, featureMaps.width, featureMaps.height, width, height);
  const brightDetails = downsampleMask(featureMaps.brightDetails, featureMaps.width, featureMaps.height, width, height);
  const featureDetails = downsampleMask(featureMaps.featureDetails, featureMaps.width, featureMaps.height, width, height);
  const featurePriority = downsampleMask(featureMaps.featurePriority, featureMaps.width, featureMaps.height, width, height);

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
