import type { Color, DrawMode, GridCell } from '../types';

interface ResolveToolActionInput {
  drawMode: DrawMode;
  selectedColor: Color | null;
  clickedCell: GridCell;
  paletteColors: Color[];
}

interface ToolActionResult {
  strokeColor: GridCell;
  shouldDraw: boolean;
  nextSelectedColor: Color | null;
  nextDrawMode: DrawMode | null;
}

export const resolveToolAction = ({
  drawMode,
  selectedColor,
  clickedCell,
  paletteColors,
}: ResolveToolActionInput): ToolActionResult => {
  if (drawMode === 'erase') {
    return {
      strokeColor: null,
      shouldDraw: true,
      nextSelectedColor: selectedColor,
      nextDrawMode: null,
    };
  }

  if (drawMode === 'pick') {
    return {
      strokeColor: null,
      shouldDraw: false,
      nextSelectedColor: clickedCell,
      nextDrawMode: clickedCell ? 'paint' : null,
    };
  }

  if (drawMode !== 'paint') {
    return {
      strokeColor: null,
      shouldDraw: false,
      nextSelectedColor: selectedColor,
      nextDrawMode: null,
    };
  }

  const fallbackColor = selectedColor ?? paletteColors[0] ?? null;
  return {
    strokeColor: fallbackColor,
    shouldDraw: Boolean(fallbackColor),
    nextSelectedColor: fallbackColor,
    nextDrawMode: null,
  };
};

export const resolveSelectedColorForPalette = (
  currentSelectedColor: Color | null,
  paletteColors: Color[],
): Color | null => {
  if (currentSelectedColor && paletteColors.some((color) => color.hex === currentSelectedColor.hex)) {
    return currentSelectedColor;
  }

  return paletteColors[0] ?? null;
};
