import { describe, expect, it } from 'vitest';
import type { ColorPalette, GridConfig } from '../types';
import { parseGridJsonPayload, parseGridJsonText } from './gridJsonImport';

const fallbackConfig: GridConfig = { width: 50, height: 50 };

const basePalette: ColorPalette = {
  id: 'base',
  name: 'Base',
  brand: 'Test',
  colors: [
    { name: '黑', hex: '#000000', rgb: { r: 0, g: 0, b: 0 } },
    { name: '白', hex: '#FFFFFF', rgb: { r: 255, g: 255, b: 255 } },
  ],
};

describe('parseGridJsonPayload', () => {
  it('parses dense exported grid json', () => {
    const result = parseGridJsonPayload({
      config: { width: 2, height: 2 },
      cells: [
        [{ name: '黑', hex: '#000000', rgb: { r: 0, g: 0, b: 0 } }, null],
        [null, { hex: '#FFFFFF', rgb: { r: 255, g: 255, b: 255 } }],
      ],
    }, fallbackConfig, basePalette);

    expect(result.config).toEqual({ width: 2, height: 2 });
    expect(result.cells[0][0]?.hex).toBe('#000000');
    expect(result.cells[1][1]?.name).toBe('白');
    expect(result.palette.colors).toHaveLength(2);
  });

  it('parses sparse coordinate json with point colors', () => {
    const result = parseGridJsonPayload({
      width: 3,
      height: 2,
      points: [
        { x: 0, y: 0, hex: '#123456', name: '深蓝' },
        { x: 2, y: 1, rgb: { r: 255, g: 0, b: 0 } },
      ],
    }, fallbackConfig);

    expect(result.config).toEqual({ width: 3, height: 2 });
    expect(result.cells[0][0]?.hex).toBe('#123456');
    expect(result.cells[0][0]?.name).toBe('深蓝');
    expect(result.cells[1][2]?.hex).toBe('#FF0000');
    expect(result.palette.colors.map((color) => color.hex)).toEqual(['#123456', '#FF0000']);
  });

  it('throws for out-of-range sparse points', () => {
    expect(() => parseGridJsonPayload({
      width: 2,
      height: 2,
      points: [{ x: 3, y: 0, hex: '#000000' }],
    }, fallbackConfig)).toThrow('超出范围');
  });

  it('parses json text with line comments', () => {
    const result = parseGridJsonText(`
      {
        "width": 2,
        "height": 2,
        "points": [
          // 左上角
          { "x": 0, "y": 0, "hex": "#000000" },
          { "x": 1, "y": 1, "hex": "#FFFFFF" } // 右下角
        ]
      }
    `, fallbackConfig, basePalette);

    expect(result.cells[0][0]?.hex).toBe('#000000');
    expect(result.cells[1][1]?.hex).toBe('#FFFFFF');
  });

  it('parses json text with block comments and keeps comment-like strings', () => {
    const result = parseGridJsonText(`
      {
        /* 尺寸定义 */
        "width": 1,
        "height": 1,
        "points": [
          {
            "x": 0,
            "y": 0,
            "name": "包含 // 文本",
            "hex": "#123456"
          }
        ]
      }
    `, fallbackConfig);

    expect(result.cells[0][0]?.name).toBe('包含 // 文本');
    expect(result.cells[0][0]?.hex).toBe('#123456');
  });
});
