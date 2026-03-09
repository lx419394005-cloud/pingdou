import type { Color } from '../types';
import type { IndexedPaletteEntry } from './pattern';

export interface BrushPaletteState {
  quickColors: Color[];
  customColor: Color | null;
}

export const buildBrushPaletteState = (
  indexedPalette: IndexedPaletteEntry[],
  paletteColors: Color[],
  selectedColor: Color | null,
  quickLimit = 8,
): BrushPaletteState => {
  const quickSource = indexedPalette.length > 0
    ? indexedPalette.map((entry) => entry.color)
    : paletteColors;
  const quickColors = quickSource.slice(0, quickLimit);
  const quickSet = new Set(quickColors.map((color) => color.hex));

  if (!selectedColor || quickSet.has(selectedColor.hex)) {
    return {
      quickColors,
      customColor: null,
    };
  }

  return {
    quickColors,
    customColor: selectedColor,
  };
};
