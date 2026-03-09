import { describe, expect, it } from 'vitest';
import { extractFeatureMaps } from './featureExtraction';
import { createPortraitFixture } from './testUtils';
import { rasterizeWorkingGrid, renderFeatureMapsToWorkingGrid } from './workingGrid';

const countHitsAround = (mask: Uint8Array, width: number, x: number, y: number, radius = 1) => {
  let total = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width) continue;
      total += mask[(ny * width) + nx] ?? 0;
    }
  }
  return total;
};

describe('workingGrid', () => {
  it('renders source input into a deterministic intermediate working grid', () => {
    const source = createPortraitFixture(180, 180);
    const working = rasterizeWorkingGrid(source, 120, 120);

    expect(working.imageData.width).toBe(120);
    expect(working.imageData.height).toBe(120);
    expect(working.alphaMask[0]).toBe(0);
    expect(working.alphaMask[(60 * 120) + 60]).toBe(1);
  });

  it('keeps feature masks aligned with the working grid rasterization', () => {
    const source = createPortraitFixture(180, 180);
    const features = extractFeatureMaps(source);
    const workingFeatures = renderFeatureMapsToWorkingGrid(features, 120, 120);

    expect(countHitsAround(workingFeatures.brightDetails, 120, 39, 51)).toBeGreaterThanOrEqual(1);
    expect(countHitsAround(workingFeatures.darkDetails, 120, 60, 79)).toBeGreaterThanOrEqual(1);
    expect(workingFeatures.strongEdges.reduce((sum, value) => sum + value, 0)).toBeGreaterThanOrEqual(100);
  });
});
