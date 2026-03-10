const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.4;
const ZOOM_STEP = 0.15;

export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(zoom.toFixed(2))));

export const stepZoom = (zoom: number, direction: 'in' | 'out') => clampZoom(
  zoom + (direction === 'in' ? ZOOM_STEP : -ZOOM_STEP),
);

export const getCenteredCanvasOffset = (viewportSize: number, canvasSize: number) => Math.max(0, (viewportSize - canvasSize) / 2);

export const shouldStartViewportPanning = ({
  button,
  isSpacePressed,
  isCanvasTarget = true,
  isPanMode = false,
}: {
  button: number;
  isSpacePressed: boolean;
  isCanvasTarget?: boolean;
  isPanMode?: boolean;
}) => button === 1 || button === 2 || isSpacePressed || (button === 0 && (!isCanvasTarget || isPanMode));

export const computeAnchoredScrollOffset = ({
  viewportSize,
  cursorOffset,
  scrollOffset,
  previousCanvasSize,
  nextCanvasSize,
  previousCellSize,
  nextCellSize,
  previousGutter,
  nextGutter,
}: {
  viewportSize: number;
  cursorOffset: number;
  scrollOffset: number;
  previousCanvasSize: number;
  nextCanvasSize: number;
  previousCellSize: number;
  nextCellSize: number;
  previousGutter: number;
  nextGutter: number;
}) => {
  const previousCanvasOffset = getCenteredCanvasOffset(viewportSize, previousCanvasSize);
  const nextCanvasOffset = getCenteredCanvasOffset(viewportSize, nextCanvasSize);
  const pointInCanvas = scrollOffset + cursorOffset - previousCanvasOffset;
  const pointInGridUnits = (pointInCanvas - previousGutter) / previousCellSize;
  const nextPointInCanvas = nextGutter + (pointInGridUnits * nextCellSize);
  const unclampedScroll = nextPointInCanvas + nextCanvasOffset - cursorOffset;
  const maxScroll = Math.max(0, nextCanvasSize - viewportSize);

  return Math.max(0, Math.min(maxScroll, Math.round(unclampedScroll)));
};
