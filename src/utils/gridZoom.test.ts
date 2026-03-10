import { describe, expect, it } from 'vitest';
import { clampZoom, computeAnchoredScrollOffset, getCenteredCanvasOffset, shouldStartViewportPanning, stepZoom } from './gridZoom';

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

  it('accounts for centered canvas offset when anchoring zoom', () => {
    expect(getCenteredCanvasOffset(600, 420)).toBe(90);
    expect(getCenteredCanvasOffset(600, 760)).toBe(0);
  });

  it('keeps the same grid point under the pointer when zooming from a centered stage', () => {
    const nextScrollLeft = computeAnchoredScrollOffset({
      viewportSize: 600,
      cursorOffset: 500,
      scrollOffset: 0,
      previousCanvasSize: 420,
      nextCanvasSize: 720,
      previousCellSize: 10,
      nextCellSize: 13,
      previousGutter: 0,
      nextGutter: 0,
    });

    expect(nextScrollLeft).toBe(33);
  });

  it('treats space drag and middle click as viewport pan gestures', () => {
    expect(shouldStartViewportPanning({ button: 0, isSpacePressed: false })).toBe(false);
    expect(shouldStartViewportPanning({ button: 1, isSpacePressed: false })).toBe(true);
    expect(shouldStartViewportPanning({ button: 2, isSpacePressed: false })).toBe(true);
    expect(shouldStartViewportPanning({ button: 0, isSpacePressed: true })).toBe(true);
    expect(shouldStartViewportPanning({ button: 0, isSpacePressed: false, isCanvasTarget: false })).toBe(true);
    expect(shouldStartViewportPanning({ button: 0, isSpacePressed: false, isCanvasTarget: true })).toBe(false);
    expect(shouldStartViewportPanning({ button: 0, isSpacePressed: false, isCanvasTarget: true, isPanMode: true })).toBe(true);
  });
});
