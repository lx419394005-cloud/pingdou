import type { Color, GridConfig } from '../types';

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface OverlaySampler {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const mapGridPointToImagePixel = (
  x: number,
  y: number,
  config: GridConfig,
  imageWidth: number,
  imageHeight: number,
) => {
  const safeWidth = Math.max(1, config.width);
  const safeHeight = Math.max(1, config.height);
  const safeImageWidth = Math.max(1, imageWidth);
  const safeImageHeight = Math.max(1, imageHeight);
  const normalizedX = (x + 0.5) / safeWidth;
  const normalizedY = (y + 0.5) / safeHeight;

  return {
    x: clamp(Math.floor(normalizedX * safeImageWidth), 0, safeImageWidth - 1),
    y: clamp(Math.floor(normalizedY * safeImageHeight), 0, safeImageHeight - 1),
  };
};

export const sampleOverlayColor = (
  sampler: OverlaySampler,
  x: number,
  y: number,
  config: GridConfig,
): RGB => {
  const pixel = mapGridPointToImagePixel(x, y, config, sampler.width, sampler.height);
  const index = (pixel.y * sampler.width + pixel.x) * 4;
  return {
    r: sampler.data[index] ?? 0,
    g: sampler.data[index + 1] ?? 0,
    b: sampler.data[index + 2] ?? 0,
  };
};

export const findNearestPaletteColor = (rgb: RGB, palette: Color[]): Color | null => {
  if (palette.length === 0) {
    return null;
  }

  let best = palette[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const color of palette) {
    const dr = color.rgb.r - rgb.r;
    const dg = color.rgb.g - rgb.g;
    const db = color.rgb.b - rgb.b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = color;
    }
  }

  return best;
};

