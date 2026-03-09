export type PatternCanvasMode = 'color' | 'number' | 'overlay';

interface PatternCellTextStyle {
  fontSize: number;
  textColor: string;
  showMarker: boolean;
}

interface PatternNumberCellStyle {
  fillColor: string;
  textColor: string;
}

interface PatternGridLineStyle {
  strokeStyle: string;
  lineWidth: number;
}

export const getPatternCellTextStyle = (
  mode: PatternCanvasMode,
  cellSize: number,
): PatternCellTextStyle => {
  if (mode === 'number') {
    return {
      fontSize: Math.max(10, Math.floor(cellSize * 0.56)),
      textColor: '#374151',
      showMarker: true,
    };
  }

  return {
    fontSize: Math.max(8, Math.floor(cellSize * 0.36)),
    textColor: '#111827',
    showMarker: false,
  };
};

const normalizeHex = (hex: string) => (hex.startsWith('#') ? hex.slice(1) : hex);

export const getPatternNumberCellStyle = (hex: string): PatternNumberCellStyle => {
  const normalized = normalizeHex(hex);
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;

  return {
    fillColor: hex,
    textColor: brightness > 148 ? '#1f2937' : '#f9fafb',
  };
};

export const getPatternGridLineStyle = (
  mode: PatternCanvasMode,
  index: number,
  baseLineWidth: number,
): PatternGridLineStyle => {
  if (mode === 'color') {
    return {
      strokeStyle: '#d6d3d1',
      lineWidth: baseLineWidth,
    };
  }

  const isMajorLine = (index + 1) % 5 === 0;
  return {
    strokeStyle: isMajorLine ? '#c5b8a5' : '#ddd5ca',
    lineWidth: isMajorLine ? Math.max(1, baseLineWidth * 1.75) : baseLineWidth,
  };
};
