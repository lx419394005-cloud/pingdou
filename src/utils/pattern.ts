import type { Color, GridCell } from '../types';

export interface IndexedPaletteEntry {
  code: number;
  color: Color;
  count: number;
}

const LETTER_NUMBER_PATTERN = /^\s*([A-Za-z]{1,3})\s*[-_/]?\s*(\d{1,3})\s*$/;

export const getDisplayCode = (code: number, colorName: string) => {
  const matched = colorName.match(LETTER_NUMBER_PATTERN);
  if (matched) {
    const [, prefix, numberText] = matched;
    return `${prefix.toUpperCase()}${numberText}`;
  }

  return `C${Math.max(1, Math.trunc(code))}`;
};

export const buildIndexedPalette = (cells: GridCell[][]): IndexedPaletteEntry[] => {
  const counts = new Map<string, IndexedPaletteEntry>();

  for (const row of cells) {
    for (const cell of row) {
      if (!cell) {
        continue;
      }

      const existing = counts.get(cell.hex);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(cell.hex, {
          code: 0,
          color: cell,
          count: 1,
        });
      }
    }
  }

  return Array.from(counts.values())
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }

      return a.color.name.localeCompare(b.color.name, 'zh-Hans-CN');
    })
    .map((entry, index) => ({
      ...entry,
      code: index + 1,
    }));
};

export const buildColorCodeMap = (cells: GridCell[][]): Map<string, number> => {
  const map = new Map<string, number>();

  for (const entry of buildIndexedPalette(cells)) {
    map.set(entry.color.hex, entry.code);
  }

  return map;
};

export const buildColorLabelMap = (cells: GridCell[][]): Map<string, string> => {
  const map = new Map<string, string>();

  for (const entry of buildIndexedPalette(cells)) {
    map.set(entry.color.hex, getDisplayCode(entry.code, entry.color.name));
  }

  return map;
};
