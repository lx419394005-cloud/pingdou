export interface Color {
  name: string;
  hex: string;
  rgb: { r: number; g: number; b: number };
}

export interface ColorPalette {
  id: string;
  name: string;
  brand: string;
  colors: Color[];
}

export interface GridConfig {
  width: number;
  height: number;
}

export type GridCell = Color | null;

export interface GridState {
  config: GridConfig;
  cells: GridCell[][];
  palette: ColorPalette | null;
}

export type DrawMode =
  | 'paint'
  | 'erase'
  | 'pick'
  | 'fill'
  | 'line'
  | 'rectangle'
  | 'ellipse'
  | 'triangle';

export type MirrorMode = 'none' | 'vertical' | 'horizontal' | 'quad';

export interface ProcessedImage {
  data: GridCell[][];
  originalWidth: number;
  originalHeight: number;
}

export type AlgorithmMode = 'legacy-clean' | 'contour-locked' | 'legacy-guided' | 'legacy-nearest';

export interface ProcessImageOptions {
  mode?: AlgorithmMode;
  contourImageData?: ImageData;
  targetColors?: number;
  workingResolution?: number;
}
