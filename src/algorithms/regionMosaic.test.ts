import { describe, expect, it } from 'vitest';
import { buildRegionMosaic } from './regionMosaic';
import { extractFeatureMaps } from './featureExtraction';
import { createPortraitFixture } from './testUtils';
import { rasterizeWorkingGrid, renderFeatureMapsToWorkingGrid } from './workingGrid';

describe('buildRegionMosaic', () => {
  it('keeps eye whites isolated from surrounding face regions', () => {
    const source = createPortraitFixture(180, 180);
    const working = rasterizeWorkingGrid(source, 120, 120);
    const featureMaps = renderFeatureMapsToWorkingGrid(extractFeatureMaps(source), 120, 120);
    const mosaic = buildRegionMosaic(working, featureMaps, { mergeThreshold: 14 });

    expect(mosaic.regionIdAt(39, 51)).not.toBe(mosaic.regionIdAt(46, 61));
    expect(mosaic.regionPriorityAt(39, 51)).toBe('feature');
  });

  it('merges smooth face and shirt pixels into larger regions without crossing contour walls', () => {
    const source = createPortraitFixture(180, 180);
    const working = rasterizeWorkingGrid(source, 120, 120);
    const featureMaps = renderFeatureMapsToWorkingGrid(extractFeatureMaps(source), 120, 120);
    const mosaic = buildRegionMosaic(working, featureMaps, { mergeThreshold: 14 });
    const faceRegionIds = new Set<number>();
    const shirtRegionIds = new Set<number>();

    for (let y = 58; y <= 74; y++) {
      for (let x = 50; x <= 68; x++) {
        faceRegionIds.add(mosaic.regionIdAt(x, y));
      }
    }

    for (let y = 90; y <= 108; y++) {
      for (let x = 52; x <= 76; x++) {
        shirtRegionIds.add(mosaic.regionIdAt(x, y));
      }
    }

    expect(mosaic.regionPriorityAt(60, 94)).toBe('region');
    expect(mosaic.regionIdAt(33, 50)).not.toBe(mosaic.regionIdAt(39, 51));
    expect(faceRegionIds.size).toBeLessThanOrEqual(12);
    expect(shirtRegionIds.size).toBeLessThanOrEqual(10);
    expect(mosaic.regionCount).toBeLessThan(working.width * working.height / 5);
  });
});
