import type { Color } from '../types';

export interface LabColor {
  l: number;
  a: number;
  b: number;
}

export const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
};

export const rgbToHex = (r: number, g: number, b: number): string => {
  return '#' + [r, g, b].map((x) => {
    const hex = Math.round(Math.max(0, Math.min(255, x))).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
};

export const colorDistance = (c1: { r: number; g: number; b: number }, c2: { r: number; g: number; b: number }): number => {
  // 使用人眼感知的加权欧几里得距离 (Redmean)
  // 这种算法在边缘处理和颜色区分上比简单的欧几里得距离更接近人眼感受
  const rMean = (c1.r + c2.r) / 2;
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;
  const weightR = 2 + rMean / 256;
  const weightG = 4;
  const weightB = 2 + (255 - rMean) / 256;
  return Math.sqrt(weightR * dr * dr + weightG * dg * dg + weightB * db * db);
};

const srgbToLinear = (v: number): number => {
  const normalized = v / 255;
  if (normalized <= 0.04045) {
    return normalized / 12.92;
  }
  return Math.pow((normalized + 0.055) / 1.055, 2.4);
};

const rgbToXyz = (r: number, g: number, b: number) => {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  return {
    x: lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375,
    y: lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175,
    z: lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041,
  };
};

const xyzToLab = (x: number, y: number, z: number): LabColor => {
  const refX = 0.95047;
  const refY = 1.0;
  const refZ = 1.08883;

  const f = (t: number): number => {
    if (t > 0.008856) {
      return Math.cbrt(t);
    }
    return (7.787 * t) + (16 / 116);
  };

  const fx = f(x / refX);
  const fy = f(y / refY);
  const fz = f(z / refZ);

  return {
    l: (116 * fy) - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
};

export const rgbToLab = (r: number, g: number, b: number): LabColor => {
  const { x, y, z } = rgbToXyz(r, g, b);
  return xyzToLab(x, y, z);
};

export const deltaE = (c1: LabColor, c2: LabColor): number => {
  const dl = c1.l - c2.l;
  const da = c1.a - c2.a;
  const db = c1.b - c2.b;
  return Math.sqrt(dl * dl + da * da + db * db);
};

export const findNearestColor = (color: { r: number; g: number; b: number }, palette: Color[]): Color => {
  let minDistance = Infinity;
  let nearestColor = palette[0];
  
  for (const c of palette) {
    const distance = colorDistance(color, c.rgb);
    if (distance < minDistance) {
      minDistance = distance;
      nearestColor = c;
    }
  }
  
  return nearestColor;
};

export const calculateAverageColor = (pixels: Uint8ClampedArray): { r: number; g: number; b: number } => {
  let r = 0, g = 0, b = 0;
  const count = pixels.length / 4;
  
  for (let i = 0; i < pixels.length; i += 4) {
    r += pixels[i];
    g += pixels[i + 1];
    b += pixels[i + 2];
  }
  
  return {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count),
  };
};
