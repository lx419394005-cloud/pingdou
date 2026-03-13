/**
 * 黑色描边算法 - 为像素图添加黑色轮廓
 *
 * 算法原理：
 * 1. 检测透明区域与非透明区域的边界
 * 2. 在边界像素上绘制黑色描边
 * 3. 支持可配置的描边粗细
 */

import type { GridCell } from '../types';

export interface BlackOutlineOptions {
  /** 描边粗细，默认为 1 */
  thickness?: number;
  /** 是否只在外边界描边（不描内部孔洞），默认为 false */
  outerOnly?: boolean;
  /** 黑色透明度，0-255，默认为 255（完全不透明） */
  opacity?: number;
}

/**
 * 检查像素是否为透明
 */
const isTransparent = (data: Uint8ClampedArray, idx: number): boolean => {
  return data[idx + 3] < 128;
};

/**
 * 获取像素的 8 邻域
 */
const getNeighbors = (x: number, y: number, width: number, height: number): Array<[number, number]> => {
  const neighbors: Array<[number, number]> = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) {
        neighbors.push([nx, ny]);
      }
    }
  }
  return neighbors;
};

/**
 * 检查像素是否为边界像素（邻域中有透明像素）
 */
const isBoundaryPixel = (data: Uint8ClampedArray, x: number, y: number, width: number): boolean => {
  const idx = (y * width + x) * 4;
  if (isTransparent(data, idx)) return false;

  const neighbors = getNeighbors(x, y, width, Math.floor(data.length / (width * 4)));
  for (const [nx, ny] of neighbors) {
    const neighborIdx = (ny * width + nx) * 4;
    if (isTransparent(data, neighborIdx)) {
      return true;
    }
  }
  return false;
};

/**
 * 为像素图添加黑色描边
 *
 * @param sourceData - 源 ImageData
 * @param options - 描边选项
 * @returns 新的 ImageData，包含黑色描边
 */
export const applyBlackOutline = (
  sourceData: ImageData,
  options: BlackOutlineOptions = {}
): ImageData => {
  const { thickness = 1, opacity = 255 } = options;
  const { width, height } = sourceData;

  // 创建目标 ImageData（复制源数据）
  const result = new ImageData(
    new Uint8ClampedArray(sourceData.data),
    width,
    height
  );
  const destData = result.data;
  const srcData = sourceData.data;

  // 收集所有边界像素
  const boundaryPixels: Set<number> = new Set();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      // 只处理非透明像素
      if (isTransparent(srcData, idx)) continue;

      // 检查是否为边界像素
      if (isBoundaryPixel(srcData, x, y, width)) {
        boundaryPixels.add(y * width + x);
      }
    }
  }

  // 对每个边界像素应用描边（向外扩散）
  const outlinePixels = new Set<number>();

  for (const pixelIdx of boundaryPixels) {
    const x = pixelIdx % width;
    const y = Math.floor(pixelIdx / width);

    // 根据粗细向外扩散
    for (let t = 0; t < thickness; t++) {
      const neighbors = getNeighbors(x, y, width, height);
      for (const [nx, ny] of neighbors) {
        const neighborIdx = ny * width + nx;
        const neighborPixelIdx = neighborIdx * 4;

        // 只在透明区域或已有描边的地方绘制
        if (isTransparent(srcData, neighborPixelIdx) || outlinePixels.has(neighborIdx)) {
          outlinePixels.add(neighborIdx);
        }
      }
    }
  }

  // 应用黑色描边
  for (const pixelIdx of outlinePixels) {
    const idx = pixelIdx * 4;
    destData[idx] = 0;         // R
    destData[idx + 1] = 0;     // G
    destData[idx + 2] = 0;     // B
    destData[idx + 3] = opacity; // A
  }

  return result;
};

/**
 * 为像素网格添加黑色描边（基于 GridCell 格式）
 *
 * @param cells - 源 GridCell 二维数组
 * @param options - 描边选项
 * @returns 新的 GridCell 二维数组，包含黑色描边
 */
export const applyBlackOutlineToGrid = (
  cells: GridCell[][],
  options: BlackOutlineOptions = {}
): GridCell[][] => {
  const { thickness = 1 } = options;
  const height = cells.length;
  const width = cells[0]?.length || 0;

  if (width === 0 || height === 0) {
    return cells;
  }

  // 创建结果网格（深拷贝）
  const result = cells.map(row => row.map(cell => cell ? { ...cell } : null));

  // 收集所有非空边界像素
  const boundaryPixels: Set<number> = new Set();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!cells[y][x]) continue;

      // 检查 8 邻域是否有空单元格
      const neighbors = getNeighbors(x, y, width, height);
      let hasEmptyNeighbor = false;

      for (const [nx, ny] of neighbors) {
        if (!cells[ny][nx]) {
          hasEmptyNeighbor = true;
          break;
        }
      }

      if (hasEmptyNeighbor) {
        boundaryPixels.add(y * width + x);
      }
    }
  }

  // 收集描边像素位置
  const outlinePositions = new Set<string>();

  for (const pixelIdx of boundaryPixels) {
    const x = pixelIdx % width;
    const y = Math.floor(pixelIdx / width);

    // 根据粗细向外扩散
    const visited = new Set<string>();
    const queue: Array<[number, number, number]> = [[x, y, 0]]; // x, y, distance

    while (queue.length > 0) {
      const [cx, cy, dist] = queue.shift()!;
      const key = `${cx},${cy}`;

      if (visited.has(key)) continue;
      visited.add(key);

      if (dist > 0) {
        outlinePositions.add(key);
      }

      if (dist < thickness) {
        const neighbors = getNeighbors(cx, cy, width, height);
        for (const [nx, ny] of neighbors) {
          const neighborKey = `${nx},${ny}`;
          if (!visited.has(neighborKey)) {
            queue.push([nx, ny, dist + 1]);
          }
        }
      }
    }
  }

  // 在空白位置应用黑色描边
  const blackColor = {
    name: 'Black',
    hex: '#000000',
    rgb: { r: 0, g: 0, b: 0 }
  };

  for (const key of outlinePositions) {
    const [x, y] = key.split(',').map(Number);
    // 只在空白单元格上绘制描边
    if (y >= 0 && y < height && x >= 0 && x < width && !result[y][x]) {
      result[y][x] = blackColor;
    }
  }

  return result;
};

export default applyBlackOutline;
