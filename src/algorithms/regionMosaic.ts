import { deltaE, rgbToLab, type LabColor } from '../utils/colorUtils';
import type { FeatureMaps } from './featureExtraction';
import type { WorkingGrid } from './workingGrid';

export type RegionPriority = 'background' | 'region' | 'feature' | 'contour';

interface RegionStats {
  id: number;
  priority: RegionPriority;
  pixels: number[];
  averageRgb: { r: number; g: number; b: number };
  averageLab: LabColor;
}

class UnionFind {
  private readonly parent: Int32Array;

  constructor(size: number) {
    this.parent = new Int32Array(size);
    for (let i = 0; i < size; i++) {
      this.parent[i] = i;
    }
  }

  find(value: number): number {
    let current = value;
    while (this.parent[current] !== current) {
      current = this.parent[current];
    }

    let next = value;
    while (this.parent[next] !== current) {
      const parent = this.parent[next];
      this.parent[next] = current;
      next = parent;
    }

    return current;
  }

  union(a: number, b: number) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) {
      this.parent[rootB] = rootA;
    }
  }
}

export interface RegionMosaic {
  width: number;
  height: number;
  regionIds: Int32Array;
  regionCount: number;
  regions: RegionStats[];
  imageData: ImageData;
  alphaMask: Uint8Array;
  regionIdAt: (x: number, y: number) => number;
  regionPriorityAt: (x: number, y: number) => RegionPriority;
}

interface BuildRegionMosaicOptions {
  mergeThreshold?: number;
}

const directions = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
] as const;

const priorityAt = (idx: number, alphaMask: Uint8Array, featureMaps: FeatureMaps): RegionPriority => {
  if (!alphaMask[idx]) return 'background';
  if (featureMaps.strongEdges[idx] || featureMaps.darkDetails[idx]) return 'contour';
  if (featureMaps.brightDetails[idx] || featureMaps.featureDetails[idx]) return 'feature';
  return 'region';
};

const componentThreshold = (priority: RegionPriority, mergeThreshold: number) => {
  if (priority === 'contour') return Math.max(8, mergeThreshold * 0.8);
  if (priority === 'feature') return Math.max(12, mergeThreshold);
  if (priority === 'background') return 100;
  return Math.max(16, mergeThreshold * 1.8);
};

export const buildRegionMosaic = (
  workingGrid: WorkingGrid,
  featureMaps: FeatureMaps,
  options?: BuildRegionMosaicOptions,
): RegionMosaic => {
  const mergeThreshold = options?.mergeThreshold ?? 12;
  const width = workingGrid.width;
  const height = workingGrid.height;
  const { data } = workingGrid.imageData;
  const labs = new Array<LabColor>(width * height);
  const regionIds = new Int32Array(width * height).fill(-1);
  const priorities = new Array<RegionPriority>(width * height);
  const regions: RegionStats[] = [];
  const alphaMask = workingGrid.alphaMask;

  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    labs[i] = rgbToLab(data[p], data[p + 1], data[p + 2]);
    priorities[i] = priorityAt(i, alphaMask, featureMaps);
  }

  for (let idx = 0; idx < width * height; idx++) {
    if (regionIds[idx] !== -1) continue;

    const priority = priorities[idx];
    const seedLab = labs[idx];
    const threshold = componentThreshold(priority, mergeThreshold);
    const queue = [idx];
    const pixels: number[] = [];
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumL = 0;
    let sumA = 0;
    let sumBChannel = 0;
    const regionId = regions.length;
    regionIds[idx] = regionId;

    while (queue.length > 0) {
      const current = queue.pop() as number;
      pixels.push(current);
      const p = current * 4;
      sumR += data[p];
      sumG += data[p + 1];
      sumB += data[p + 2];
      sumL += labs[current].l;
      sumA += labs[current].a;
      sumBChannel += labs[current].b;

      const currentAverage = {
        l: sumL / pixels.length,
        a: sumA / pixels.length,
        b: sumBChannel / pixels.length,
      };
      const x = current % width;
      const y = Math.floor(current / width);

      for (const [dx, dy] of directions) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighborIdx = (ny * width) + nx;
        if (regionIds[neighborIdx] !== -1) continue;
        if (priorities[neighborIdx] !== priority) continue;

        const neighborLab = labs[neighborIdx];
        const limit = priority === 'region' ? threshold : threshold * 0.8;
        if (deltaE(seedLab, neighborLab) > threshold) continue;
        if (deltaE(currentAverage, neighborLab) > limit) continue;

        regionIds[neighborIdx] = regionId;
        queue.push(neighborIdx);
      }
    }

    const averageRgb = {
      r: Math.round(sumR / pixels.length),
      g: Math.round(sumG / pixels.length),
      b: Math.round(sumB / pixels.length),
    };
    regions.push({
      id: regionId,
      priority,
      pixels,
      averageRgb,
      averageLab: {
        l: sumL / pixels.length,
        a: sumA / pixels.length,
        b: sumBChannel / pixels.length,
      },
    });
  }

  const unionFind = new UnionFind(regions.length);
  const mergeLimit = mergeThreshold * 1.6;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width) + x;
      const regionId = regionIds[idx];
      const region = regions[regionId];
      if (region.priority === 'contour') continue;

      if (x + 1 < width) {
        const neighborId = regionIds[idx + 1];
        if (neighborId !== regionId) {
          const neighborRegion = regions[neighborId];
          if (
            neighborRegion.priority === region.priority &&
            deltaE(region.averageLab, neighborRegion.averageLab) <= (region.priority === 'feature' ? mergeThreshold : mergeLimit)
          ) {
            unionFind.union(regionId, neighborId);
          }
        }
      }

      if (y + 1 < height) {
        const neighborId = regionIds[idx + width];
        if (neighborId !== regionId) {
          const neighborRegion = regions[neighborId];
          if (
            neighborRegion.priority === region.priority &&
            deltaE(region.averageLab, neighborRegion.averageLab) <= (region.priority === 'feature' ? mergeThreshold : mergeLimit)
          ) {
            unionFind.union(regionId, neighborId);
          }
        }
      }
    }
  }

  const mergedRegions: RegionStats[] = [];
  const rootToRegion = new Map<number, number>();
  const nextRegionIds = new Int32Array(regionIds.length).fill(-1);

  for (let idx = 0; idx < regionIds.length; idx++) {
    const root = unionFind.find(regionIds[idx]);
    let mergedId = rootToRegion.get(root);
    if (mergedId === undefined) {
      mergedId = mergedRegions.length;
      rootToRegion.set(root, mergedId);
      mergedRegions.push({
        id: mergedId,
        priority: regions[root].priority,
        pixels: [],
        averageRgb: { r: 0, g: 0, b: 0 },
        averageLab: { l: 0, a: 0, b: 0 },
      });
    }

    const region = mergedRegions[mergedId];
    region.pixels.push(idx);
    const p = idx * 4;
    region.averageRgb.r += data[p];
    region.averageRgb.g += data[p + 1];
    region.averageRgb.b += data[p + 2];
    region.averageLab.l += labs[idx].l;
    region.averageLab.a += labs[idx].a;
    region.averageLab.b += labs[idx].b;
    nextRegionIds[idx] = mergedId;
  }

  for (const region of mergedRegions) {
    const size = Math.max(1, region.pixels.length);
    region.averageRgb = {
      r: Math.round(region.averageRgb.r / size),
      g: Math.round(region.averageRgb.g / size),
      b: Math.round(region.averageRgb.b / size),
    };
    region.averageLab = {
      l: region.averageLab.l / size,
      a: region.averageLab.a / size,
      b: region.averageLab.b / size,
    };
  }

  return {
    width,
    height,
    regionIds: nextRegionIds,
    regionCount: mergedRegions.length,
    regions: mergedRegions,
    imageData: workingGrid.imageData,
    alphaMask,
    regionIdAt: (x: number, y: number) => nextRegionIds[(y * width) + x],
    regionPriorityAt: (x: number, y: number) => priorities[(y * width) + x],
  };
};
