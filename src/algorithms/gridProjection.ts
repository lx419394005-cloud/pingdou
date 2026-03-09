import type { RegionMosaic, RegionPriority } from './regionMosaic';

export interface ProjectedCell {
  rgb: { r: number; g: number; b: number };
  alpha: number;
  priority: RegionPriority;
  regionId: number;
}

export interface ProjectedGrid {
  width: number;
  height: number;
  cells: ProjectedCell[][];
}

const getWeight = (priority: RegionPriority) => {
  if (priority === 'contour') return 18;
  if (priority === 'feature') return 12;
  if (priority === 'region') return 2;
  return 1;
};

const cloneCell = (cell: ProjectedCell): ProjectedCell => ({
  rgb: { ...cell.rgb },
  alpha: cell.alpha,
  priority: cell.priority,
  regionId: cell.regionId,
});

const repairTinyGaps = (cells: ProjectedCell[][]) => {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const current = cells[y][x];
      const left = cells[y][x - 1];
      const right = cells[y][x + 1];
      const up = cells[y - 1][x];
      const down = cells[y + 1][x];

      if (left.priority === right.priority && left.priority !== 'region') {
        if (current.priority === 'region' || current.alpha === 0) {
          cells[y][x] = cloneCell(left);
          continue;
        }
      }

      if (up.priority === down.priority && up.priority !== 'region') {
        if (current.priority === 'region' || current.alpha === 0) {
          cells[y][x] = cloneCell(up);
        }
      }
    }
  }
};

export const projectMosaicToGrid = (mosaic: RegionMosaic, width: number, height: number): ProjectedGrid => {
  const cells = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({
      rgb: { r: 255, g: 255, b: 255 },
      alpha: 0,
      priority: 'background' as RegionPriority,
      regionId: -1,
    })),
  );

  for (let y = 0; y < height; y++) {
    const y0 = Math.floor((y * mosaic.height) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * mosaic.height) / height));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * mosaic.width) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * mosaic.width) / width));
      const votes = new Map<number, number>();
      const priorityVotes = new Map<number, number>();

      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const idx = (sy * mosaic.width) + sx;
          if (!mosaic.alphaMask[idx]) continue;
          const regionId = mosaic.regionIds[idx];
          const region = mosaic.regions[regionId];
          const weight = getWeight(region.priority);
          votes.set(regionId, (votes.get(regionId) ?? 0) + weight);
          priorityVotes.set(regionId, (priorityVotes.get(regionId) ?? 0) + 1);
        }
      }

      if (votes.size === 0) {
        continue;
      }

      const [regionId] = Array.from(votes.entries()).sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return (priorityVotes.get(b[0]) ?? 0) - (priorityVotes.get(a[0]) ?? 0);
      })[0];
      const region = mosaic.regions[regionId];
      cells[y][x] = {
        rgb: { ...region.averageRgb },
        alpha: region.priority === 'background' ? 0 : 255,
        priority: region.priority,
        regionId,
      };
    }
  }

  repairTinyGaps(cells);

  return { width, height, cells };
};
