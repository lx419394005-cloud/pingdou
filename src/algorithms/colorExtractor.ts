import type { Color } from '../types';
import { rgbToHex } from '../utils/colorUtils';

interface GridDetectionResult {
  rows: number;
  cols: number;
  cells: { x: number; y: number; width: number; height: number }[];
}

export const detectColorGrid = (
  canvas: HTMLCanvasElement
): GridDetectionResult => {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot get canvas context');
  
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const width = canvas.width;
  const height = canvas.height;
  
  const gray: number[] = [];
  for (let i = 0; i < imageData.data.length; i += 4) {
    const avg = (imageData.data[i] + imageData.data[i + 1] + imageData.data[i + 2]) / 3;
    gray.push(avg);
  }
  
  const threshold = 200;
  const binary = gray.map((v) => (v < threshold ? 1 : 0));
  
  const projections = { x: new Array(width).fill(0), y: new Array(height).fill(0) };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (binary[idx] === 1) {
        projections.x[x]++;
        projections.y[y]++;
      }
    }
  }
  
  const findPeaks = (arr: number[]): { start: number; end: number }[] => {
    const peaks: { start: number; end: number }[] = [];
    let start = -1;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] > 0 && start === -1) start = i;
      else if (arr[i] === 0 && start !== -1) {
        if (i - start > 10) peaks.push({ start, end: i - 1 });
        start = -1;
      }
    }
    if (start !== -1 && arr.length - start > 10) peaks.push({ start, end: arr.length - 1 });
    return peaks;
  };
  
  const xPeaks = findPeaks(projections.x);
  const yPeaks = findPeaks(projections.y);
  
  const cells: { x: number; y: number; width: number; height: number }[] = [];
  for (const xPeak of xPeaks) {
    for (const yPeak of yPeaks) {
      cells.push({
        x: xPeak.start,
        y: yPeak.start,
        width: xPeak.end - xPeak.start + 1,
        height: yPeak.end - yPeak.start + 1,
      });
    }
  }
  
  return {
    rows: yPeaks.length,
    cols: xPeaks.length,
    cells,
  };
};

export const extractColorsFromCanvas = (
  canvas: HTMLCanvasElement,
  gridResult: GridDetectionResult
): Color[] => {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot get canvas context');
  
  const colors: Color[] = [];
  
  for (let i = 0; i < gridResult.cells.length; i++) {
    const cell = gridResult.cells[i];
    const cellData = ctx.getImageData(
      cell.x + cell.width * 0.25,
      cell.y + cell.height * 0.25,
      cell.width * 0.5,
      cell.height * 0.5
    );
    
    const pixels = cellData.data;
    let r = 0, g = 0, b = 0, count = 0;
    
    for (let j = 0; j < pixels.length; j += 4) {
      const alpha = pixels[j + 3];
      if (alpha > 128) {
        r += pixels[j];
        g += pixels[j + 1];
        b += pixels[j + 2];
        count++;
      }
    }
    
    if (count > 0) {
      r = Math.round(r / count);
      g = Math.round(g / count);
      b = Math.round(b / count);
      const hex = rgbToHex(r, g, b);
      colors.push({
        name: `颜色 ${i + 1}`,
        hex,
        rgb: { r, g, b },
      });
    }
  }
  
  return colors;
};
