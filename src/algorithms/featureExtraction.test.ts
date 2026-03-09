import { describe, expect, it } from 'vitest';
import { extractFeatureMaps } from './featureExtraction';
import { createPortraitFixture } from './testUtils';

const countHitsAround = (mask: Uint8Array, width: number, x: number, y: number, radius = 2) => {
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

describe('extractFeatureMaps', () => {
  it('detects strong contour energy around glasses and head boundaries', () => {
    const source = createPortraitFixture(180, 180);
    const features = extractFeatureMaps(source);

    expect(countHitsAround(features.strongEdges, 180, 50, 76)).toBeGreaterThanOrEqual(4);
    expect(countHitsAround(features.strongEdges, 180, 50, 126)).toBeGreaterThanOrEqual(4);
  });

  it('detects enclosed bright eye whites separately from non-feature background', () => {
    const source = createPortraitFixture(180, 180);
    const features = extractFeatureMaps(source);

    expect(countHitsAround(features.brightDetails, 180, 58, 76)).toBeGreaterThanOrEqual(1);
    expect(countHitsAround(features.brightDetails, 180, 118, 76)).toBeGreaterThanOrEqual(1);
    expect(countHitsAround(features.brightDetails, 180, 20, 20)).toBe(0);
  });

  it('detects thin dark features such as the mouth and glasses bridge', () => {
    const source = createPortraitFixture(180, 180);
    const features = extractFeatureMaps(source);

    expect(countHitsAround(features.darkDetails, 180, 90, 119)).toBeGreaterThanOrEqual(1);
    expect(countHitsAround(features.featurePriority, 180, 90, 76)).toBeGreaterThanOrEqual(1);
  });
});
