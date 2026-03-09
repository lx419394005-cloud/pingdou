const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.4;
const ZOOM_STEP = 0.15;

export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(zoom.toFixed(2))));

export const stepZoom = (zoom: number, direction: 'in' | 'out') => clampZoom(
  zoom + (direction === 'in' ? ZOOM_STEP : -ZOOM_STEP),
);
