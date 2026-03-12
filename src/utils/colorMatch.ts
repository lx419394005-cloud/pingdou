import type { Color, GridConfig } from '../types';
import { rgbToLab, deltaE } from './colorUtils';

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

interface LabColor {
  l: number;
  a: number;
  b: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const rgbToLabSimple = (rgb: RGB): LabColor => {
  return rgbToLab(rgb.r, rgb.g, rgb.b);
};

const colorDistanceLab = (c1: RGB, c2: RGB): number => {
  const lab1 = rgbToLabSimple(c1);
  const lab2 = rgbToLabSimple(c2);
  return deltaE(lab1, lab2);
};

const colorDistanceRGB = (c1: RGB, c2: RGB): number => {
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
};

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

export const findNearestPaletteColor = (rgb: RGB, palette: Color[], useLab: boolean = true): Color | null => {
  if (palette.length === 0) {
    return null;
  }

  let best = palette[0];
  let bestDistance = useLab ? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;
  
  for (const color of palette) {
    const distance = useLab 
      ? colorDistanceLab(rgb, color.rgb)
      : colorDistanceRGB(rgb, color.rgb);
    
    if (distance < bestDistance) {
      bestDistance = distance;
      best = color;
    }
  }

  return best;
};

