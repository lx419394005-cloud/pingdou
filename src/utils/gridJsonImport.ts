import type { Color, ColorPalette, GridCell, GridConfig } from '../types';

interface JsonRgb {
  r: number;
  g: number;
  b: number;
}

interface JsonColorValue {
  name?: string;
  hex?: string;
  rgb?: JsonRgb;
}

interface JsonPointValue extends JsonColorValue {
  x: number;
  y: number;
  color?: string | JsonColorValue | null;
}

interface GridJsonImportResult {
  config: GridConfig;
  cells: GridCell[][];
  palette: ColorPalette;
}

const clampChannel = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

const toHex = (value: number) => clampChannel(value).toString(16).padStart(2, '0');

const rgbToHex = (rgb: JsonRgb) => `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`.toUpperCase();

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

const parseRgb = (value: unknown): JsonRgb | null => {
  if (!isRecord(value)) {
    return null;
  }

  const { r, g, b } = value;
  if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') {
    return null;
  }

  return {
    r: clampChannel(r),
    g: clampChannel(g),
    b: clampChannel(b),
  };
};

const parseHex = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  const normalized = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }

  return normalized.toUpperCase();
};

const hexToRgb = (hex: string): JsonRgb => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
});

const createCellColor = (
  value: unknown,
  colorIndex: Map<string, Color>,
): Color | null => {
  if (value == null) {
    return null;
  }

  let colorValue: JsonColorValue | null = null;
  if (typeof value === 'string') {
    const hex = parseHex(value);
    if (!hex) {
      throw new Error(`无效颜色值：${value}`);
    }
    colorValue = { hex };
  } else if (isRecord(value)) {
    colorValue = value;
  } else {
    throw new Error('颜色定义必须是字符串或对象');
  }

  const rgb = parseRgb(colorValue.rgb);
  const hex = parseHex(colorValue.hex) ?? (rgb ? rgbToHex(rgb) : null);
  if (!hex) {
    throw new Error('颜色定义缺少 hex 或 rgb');
  }

  const existing = colorIndex.get(hex);
  if (existing) {
    return existing;
  }

  const nextRgb = rgb ?? hexToRgb(hex);
  const nextColor: Color = {
    name: typeof colorValue.name === 'string' && colorValue.name.trim()
      ? colorValue.name.trim()
      : hex,
    hex,
    rgb: nextRgb,
  };
  colorIndex.set(hex, nextColor);
  return nextColor;
};

const createEmptyGrid = (width: number, height: number): GridCell[][] => (
  Array.from({ length: height }, () => Array<GridCell>(width).fill(null))
);

const parseConfig = (payload: Record<string, unknown>, fallbackConfig: GridConfig): GridConfig => {
  const configValue = isRecord(payload.config) ? payload.config : null;
  const width = typeof payload.width === 'number'
    ? payload.width
    : typeof configValue?.width === 'number'
      ? configValue.width
      : fallbackConfig.width;
  const height = typeof payload.height === 'number'
    ? payload.height
    : typeof configValue?.height === 'number'
      ? configValue.height
      : fallbackConfig.height;

  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('JSON 中的 width/height 必须是正整数');
  }

  return { width, height };
};

const seedColorIndex = (palette?: ColorPalette | null): Map<string, Color> => {
  const index = new Map<string, Color>();
  for (const color of palette?.colors ?? []) {
    index.set(color.hex.toUpperCase(), {
      ...color,
      hex: color.hex.toUpperCase(),
      rgb: {
        r: clampChannel(color.rgb.r),
        g: clampChannel(color.rgb.g),
        b: clampChannel(color.rgb.b),
      },
    });
  }
  return index;
};

const parseDenseCells = (
  payload: Record<string, unknown>,
  config: GridConfig,
  colorIndex: Map<string, Color>,
): GridCell[][] | null => {
  if (!Array.isArray(payload.cells) || payload.cells.length === 0 || !Array.isArray(payload.cells[0])) {
    return null;
  }

  if (payload.cells.length !== config.height) {
    throw new Error(`cells 行数与 height 不一致，应为 ${config.height}`);
  }

  return payload.cells.map((row, y) => {
    if (!Array.isArray(row) || row.length !== config.width) {
      throw new Error(`第 ${y + 1} 行列数与 width 不一致，应为 ${config.width}`);
    }

    return row.map((cell) => {
      if (cell == null) {
        return null;
      }
      return createCellColor(cell, colorIndex);
    });
  });
};

const parseSparsePoints = (
  payload: Record<string, unknown>,
  config: GridConfig,
  colorIndex: Map<string, Color>,
): GridCell[][] | null => {
  const list = Array.isArray(payload.points)
    ? payload.points
    : Array.isArray(payload.cells) && payload.cells.every((item) => isRecord(item) && !Array.isArray(item))
      ? payload.cells
      : null;

  if (!list) {
    return null;
  }

  const grid = createEmptyGrid(config.width, config.height);
  for (const item of list) {
    if (!isRecord(item)) {
      throw new Error('points/cells 稀疏格式里的每一项都必须是对象');
    }

    const point = item as unknown as JsonPointValue;
    if (!Number.isInteger(point.x) || !Number.isInteger(point.y)) {
      throw new Error('坐标项必须包含整数 x 和 y');
    }
    if (point.x < 0 || point.y < 0 || point.x >= config.width || point.y >= config.height) {
      throw new Error(`坐标 (${point.x}, ${point.y}) 超出范围`);
    }

    const color = point.color ?? {
      name: point.name,
      hex: point.hex,
      rgb: point.rgb,
    };
    grid[point.y][point.x] = createCellColor(color, colorIndex);
  }

  return grid;
};

const buildPalette = (payload: Record<string, unknown>, colorIndex: Map<string, Color>): ColorPalette => {
  const colors = Array.from(colorIndex.values());
  const id = typeof payload.id === 'string' && payload.id.trim()
    ? payload.id.trim()
    : `json-import-${Date.now()}`;
  const name = typeof payload.name === 'string' && payload.name.trim()
    ? payload.name.trim()
    : 'JSON 导入色卡';
  const brand = typeof payload.brand === 'string' && payload.brand.trim()
    ? payload.brand.trim()
    : 'JSON Import';

  return {
    id,
    name,
    brand,
    colors,
  };
};

const stripJsonComments = (source: string): string => {
  let result = '';
  let inString = false;
  let stringQuote = '"';
  let escaped = false;
  let index = 0;

  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];

    if (inString) {
      result += current;
      if (escaped) {
        escaped = false;
      } else if (current === '\\') {
        escaped = true;
      } else if (current === stringQuote) {
        inString = false;
      }
      index += 1;
      continue;
    }

    if (current === '"' || current === '\'') {
      inString = true;
      stringQuote = current;
      result += current;
      index += 1;
      continue;
    }

    if (current === '/' && next === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') {
        index += 1;
      }
      continue;
    }

    if (current === '/' && next === '*') {
      index += 2;
      while (index < source.length) {
        if (source[index] === '*' && source[index + 1] === '/') {
          index += 2;
          break;
        }
        index += 1;
      }
      continue;
    }

    result += current;
    index += 1;
  }

  return result;
};

export const parseGridJsonText = (
  source: string,
  fallbackConfig: GridConfig,
  palette?: ColorPalette | null,
): GridJsonImportResult => {
  const stripped = stripJsonComments(source);
  return parseGridJsonPayload(JSON.parse(stripped), fallbackConfig, palette);
};

export const parseGridJsonPayload = (
  payload: unknown,
  fallbackConfig: GridConfig,
  palette?: ColorPalette | null,
): GridJsonImportResult => {
  if (!isRecord(payload)) {
    throw new Error('JSON 根对象必须是对象');
  }

  const config = parseConfig(payload, fallbackConfig);
  const colorIndex = seedColorIndex(palette);
  const denseCells = parseDenseCells(payload, config, colorIndex);
  const sparseCells = denseCells ?? parseSparsePoints(payload, config, colorIndex);
  if (!sparseCells) {
    throw new Error('JSON 需要提供二维 cells，或 points/cells 稀疏坐标数组');
  }

  return {
    config,
    cells: sparseCells,
    palette: buildPalette(payload, colorIndex),
  };
};
