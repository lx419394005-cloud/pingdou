import { describe, expect, it } from 'vitest';
import { buildRegionMosaic } from './regionMosaic';
import { extractFeatureMaps } from './featureExtraction';
import { projectMosaicToGrid } from './gridProjection';
import { createPortraitFixture } from './testUtils';
import { rasterizeWorkingGrid, renderFeatureMapsToWorkingGrid } from './workingGrid';

const countBrightCells = (grid: ReturnType<typeof projectMosaicToGrid>) =>
  grid.cells.flat().filter((cell) => cell.alpha > 0 && cell.rgb.r >= 210 && cell.rgb.g >= 210 && cell.rgb.b >= 210).length;

const countJawRows = (grid: ReturnType<typeof projectMosaicToGrid>) => {
  let rows = 0;
  for (let y = 31; y <= 37; y++) {
    const rowHasJaw = [13, 14, 35, 36].some((x) => {
      const cell = grid.cells[y]?.[x];
      return cell && cell.alpha > 0 && cell.rgb.r < 180 && cell.rgb.g < 140;
    });
    if (rowHasJaw) {
      rows++;
    }
  }
  return rows;
};

const countFaceSkinCells = (grid: ReturnType<typeof projectMosaicToGrid>) => {
  let total = 0;
  for (let y = 19; y <= 29; y++) {
    for (let x = 14; x <= 34; x++) {
      const cell = grid.cells[y]?.[x];
      if (cell && cell.alpha > 0 && cell.rgb.r >= 180 && cell.rgb.g >= 140 && cell.rgb.b >= 110) {
        total++;
      }
    }
  }
  return total;
};

describe('projectMosaicToGrid', () => {
  it('projects preserved feature regions into the final grid without losing eye whites', () => {
    const source = createPortraitFixture(180, 180);
    const working = rasterizeWorkingGrid(source, 120, 120);
    const featureMaps = renderFeatureMapsToWorkingGrid(extractFeatureMaps(source), 120, 120);
    const mosaic = buildRegionMosaic(working, featureMaps, { mergeThreshold: 14 });
    const projected = projectMosaicToGrid(mosaic, 50, 50);

    expect(projected.width).toBe(50);
    expect(projected.height).toBe(50);
    expect(countBrightCells(projected)).toBeGreaterThanOrEqual(2);
  });

  it('keeps jaw and mouth contours continuous after 120x120 to 50x50 projection', () => {
    const source = createPortraitFixture(180, 180);
    const working = rasterizeWorkingGrid(source, 120, 120);
    const featureMaps = renderFeatureMapsToWorkingGrid(extractFeatureMaps(source), 120, 120);
    const mosaic = buildRegionMosaic(working, featureMaps, { mergeThreshold: 14 });
    const projected = projectMosaicToGrid(mosaic, 50, 50);

    expect(countJawRows(projected)).toBeGreaterThanOrEqual(4);
    expect(countFaceSkinCells(projected)).toBeGreaterThanOrEqual(90);
  });
});
