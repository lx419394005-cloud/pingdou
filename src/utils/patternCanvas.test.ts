import { describe, expect, it } from 'vitest';
import { getPatternCellTextStyle, getPatternGridLineStyle, getPatternNumberCellStyle } from './patternCanvas';

describe('patternCanvas', () => {
  it('uses clean centered numbering for standard numbered patterns', () => {
    const style = getPatternCellTextStyle('number', 24);

    expect(style.showMarker).toBe(true);
    expect(style.fontSize).toBeGreaterThanOrEqual(12);
  });

  it('keeps bead color visible under the number in numbered patterns', () => {
    const style = getPatternNumberCellStyle('#1f2937');

    expect(style.fillColor).toBe('#1f2937');
    expect(style.textColor).toBe('#f9fafb');
  });

  it('emphasizes every fifth grid line in numbered views', () => {
    const major = getPatternGridLineStyle('number', 4, 0.8);
    const minor = getPatternGridLineStyle('number', 3, 0.8);

    expect(major.lineWidth).toBeGreaterThan(minor.lineWidth);
    expect(major.strokeStyle).not.toBe(minor.strokeStyle);
  });
});
