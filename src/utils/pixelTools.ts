import type { GridCell, GridConfig, MirrorMode } from '../types';

export interface GridPoint {
  x: number;
  y: number;
}

export type ShapeTool = 'line' | 'rectangle' | 'ellipse' | 'triangle';

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const pointKey = ({ x, y }: GridPoint) => `${x},${y}`;

const normalizeBounds = (start: GridPoint, end: GridPoint): Bounds => ({
  minX: Math.min(start.x, end.x),
  maxX: Math.max(start.x, end.x),
  minY: Math.min(start.y, end.y),
  maxY: Math.max(start.y, end.y),
});

const dedupePoints = (points: GridPoint[]) => {
  const seen = new Set<string>();
  return points.filter((point) => {
    const key = pointKey(point);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

export const getRectangleCells = (start: GridPoint, end: GridPoint): GridPoint[] => {
  const { minX, maxX, minY, maxY } = normalizeBounds(start, end);
  const points: GridPoint[] = [];

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      points.push({ x, y });
    }
  }

  return points;
};

export const getEllipseCells = (start: GridPoint, end: GridPoint): GridPoint[] => {
  const { minX, maxX, minY, maxY } = normalizeBounds(start, end);
  const radiusX = Math.max(0.5, (maxX - minX + 1) / 2);
  const radiusY = Math.max(0.5, (maxY - minY + 1) / 2);
  const centerX = minX + radiusX - 0.5;
  const centerY = minY + radiusY - 0.5;
  const points: GridPoint[] = [];

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const normalizedX = ((x - centerX) ** 2) / (radiusX ** 2);
      const normalizedY = ((y - centerY) ** 2) / (radiusY ** 2);
      if (normalizedX + normalizedY <= 1) {
        points.push({ x, y });
      }
    }
  }

  return points;
};

export const getTriangleCells = (start: GridPoint, end: GridPoint): GridPoint[] => {
  const { minX, maxX, minY, maxY } = normalizeBounds(start, end);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const apexX = (minX + maxX) / 2;
  const points: GridPoint[] = [];

  for (let y = minY; y <= maxY; y += 1) {
    const progress = height === 0 ? 1 : (y - minY) / height;
    const halfSpan = (width / 2) * progress;
    const left = Math.ceil(apexX - halfSpan);
    const right = Math.floor(apexX + halfSpan);

    for (let x = left; x <= right; x += 1) {
      points.push({ x, y });
    }
  }

  return points;
};

export const getLineCells = (start: GridPoint, end: GridPoint): GridPoint[] => {
  const points: GridPoint[] = [];
  let x0 = start.x;
  let y0 = start.y;
  const x1 = end.x;
  const y1 = end.y;
  const deltaX = Math.abs(x1 - x0);
  const deltaY = Math.abs(y1 - y0);
  const stepX = x0 < x1 ? 1 : -1;
  const stepY = y0 < y1 ? 1 : -1;
  let error = deltaX - deltaY;

  while (true) {
    points.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) {
      break;
    }

    const doubleError = error * 2;
    if (doubleError > -deltaY) {
      error -= deltaY;
      x0 += stepX;
    }
    if (doubleError < deltaX) {
      error += deltaX;
      y0 += stepY;
    }
  }

  return points;
};

export const getShapeCells = (tool: ShapeTool, start: GridPoint, end: GridPoint): GridPoint[] => {
  switch (tool) {
    case 'rectangle':
      return getRectangleCells(start, end);
    case 'ellipse':
      return getEllipseCells(start, end);
    case 'triangle':
      return getTriangleCells(start, end);
    case 'line':
      return getLineCells(start, end);
    default:
      return [];
  }
};

const isSameCell = (left: GridCell, right: GridCell) => left?.hex === right?.hex;

export const getFloodFillCells = (cells: GridCell[][], start: GridPoint, nextColor: GridCell): GridPoint[] => {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  const target = cells[start.y]?.[start.x];

  if (start.x < 0 || start.y < 0 || start.x >= width || start.y >= height || isSameCell(target, nextColor)) {
    return [];
  }

  const queue: GridPoint[] = [start];
  const seen = new Set<string>();
  const filled: GridPoint[] = [];

  while (queue.length > 0) {
    const point = queue.shift()!;
    const key = pointKey(point);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const cell = cells[point.y]?.[point.x];
    if (!isSameCell(cell, target)) {
      continue;
    }

    filled.push(point);

    if (point.x > 0) {
      queue.push({ x: point.x - 1, y: point.y });
    }
    if (point.x < width - 1) {
      queue.push({ x: point.x + 1, y: point.y });
    }
    if (point.y > 0) {
      queue.push({ x: point.x, y: point.y - 1 });
    }
    if (point.y < height - 1) {
      queue.push({ x: point.x, y: point.y + 1 });
    }
  }

  return filled;
};

export const getMirroredPoints = (point: GridPoint, config: GridConfig, mirrorMode: MirrorMode): GridPoint[] => {
  if (mirrorMode === 'none') {
    return [point];
  }

  const verticalPoint = { x: config.width - 1 - point.x, y: point.y };
  const horizontalPoint = { x: point.x, y: config.height - 1 - point.y };
  const diagonalPoint = { x: config.width - 1 - point.x, y: config.height - 1 - point.y };

  if (mirrorMode === 'vertical') {
    return dedupePoints([point, verticalPoint]);
  }

  if (mirrorMode === 'horizontal') {
    return dedupePoints([point, horizontalPoint]);
  }

  return dedupePoints([point, verticalPoint, horizontalPoint, diagonalPoint]);
};

export const applyMirrorToPoints = (
  points: GridPoint[],
  config: GridConfig,
  mirrorMode: MirrorMode,
) => dedupePoints(points.flatMap((point) => getMirroredPoints(point, config, mirrorMode)));

export const clipPointsToGrid = (points: GridPoint[], config: GridConfig) => dedupePoints(
  points.filter((point) => point.x >= 0 && point.y >= 0 && point.x < config.width && point.y < config.height),
);
