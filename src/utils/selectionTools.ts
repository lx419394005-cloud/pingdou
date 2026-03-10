import type { GridConfig, GridCell } from '../types';
import type { GridPoint } from './pixelTools';

interface MoveDelta {
  x: number;
  y: number;
}

const toKey = (point: GridPoint) => `${point.x},${point.y}`;

const isPointInBounds = (point: GridPoint, config: GridConfig) => (
  point.x >= 0
  && point.y >= 0
  && point.x < config.width
  && point.y < config.height
);

const dedupePoints = (points: GridPoint[]) => {
  const seen = new Set<string>();
  const result: GridPoint[] = [];
  for (const point of points) {
    const key = toKey(point);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(point);
  }
  return result;
};

export const getSelectionRectPoints = (
  start: GridPoint,
  end: GridPoint,
  config: GridConfig,
) => {
  const left = Math.max(0, Math.min(start.x, end.x));
  const right = Math.min(config.width - 1, Math.max(start.x, end.x));
  const top = Math.max(0, Math.min(start.y, end.y));
  const bottom = Math.min(config.height - 1, Math.max(start.y, end.y));
  const result: GridPoint[] = [];
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      result.push({ x, y });
    }
  }
  return result;
};

export const translateSelectionPoints = (
  points: GridPoint[],
  delta: MoveDelta,
  config: GridConfig,
) => {
  const moved = points
    .map((point) => ({ x: point.x + delta.x, y: point.y + delta.y }))
    .filter((point) => isPointInBounds(point, config));
  return dedupePoints(moved);
};

export const applySelectionMove = (
  cells: GridCell[][],
  selectedPoints: GridPoint[],
  delta: MoveDelta,
  config: GridConfig,
) => {
  const normalizedSelection = dedupePoints(
    selectedPoints.filter((point) => isPointInBounds(point, config)),
  );
  const nextSelection = translateSelectionPoints(normalizedSelection, delta, config);
  if (normalizedSelection.length === 0 || (delta.x === 0 && delta.y === 0)) {
    return {
      changed: false,
      cells: cells.map((row) => [...row]),
      selection: nextSelection,
    };
  }

  const nextCells = cells.map((row) => [...row]);
  const moveEntries = normalizedSelection.map((point) => ({
    source: point,
    target: { x: point.x + delta.x, y: point.y + delta.y },
    color: cells[point.y]?.[point.x] ?? null,
  }));

  for (const entry of moveEntries) {
    nextCells[entry.source.y][entry.source.x] = null;
  }

  let changed = false;
  for (const entry of moveEntries) {
    if (!entry.color || !isPointInBounds(entry.target, config)) {
      continue;
    }
    const current = nextCells[entry.target.y][entry.target.x];
    if (!current || current.hex !== entry.color.hex || entry.target.x !== entry.source.x || entry.target.y !== entry.source.y) {
      changed = true;
    }
    nextCells[entry.target.y][entry.target.x] = entry.color;
  }

  const sourceHadAnyColor = moveEntries.some((entry) => Boolean(entry.color));
  return {
    changed: changed || sourceHadAnyColor,
    cells: nextCells,
    selection: nextSelection,
  };
};
