import { describe, expect, it } from 'vitest';
import { clampZoom, stepZoom } from './gridZoom';

describe('gridZoom', () => {
  it('clamps zoom values into the supported range', () => {
    expect(clampZoom(0.1)).toBe(0.35);
    expect(clampZoom(1.25)).toBe(1.25);
    expect(clampZoom(3)).toBe(2.4);
  });

  it('steps zoom upward and downward in fixed increments', () => {
    expect(stepZoom(1, 'in')).toBe(1.15);
    expect(stepZoom(1, 'out')).toBe(0.85);
  });
});
