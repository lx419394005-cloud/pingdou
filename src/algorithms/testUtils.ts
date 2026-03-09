import type { Color, GridCell } from '../types';

export const createImageData = (
  width: number,
  height: number,
  fill: (x: number, y: number) => { r: number; g: number; b: number; a?: number },
): ImageData => {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const { r, g, b, a = 255 } = fill(x, y);
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }

  return { width, height, data } as ImageData;
};

export const makePalette = (size: number): Color[] => {
  const colors: Color[] = [];
  for (let i = 0; i < size; i++) {
    const r = (i * 37) % 256;
    const g = (i * 67) % 256;
    const b = (i * 97) % 256;
    colors.push({
      name: `C${i + 1}`,
      hex: `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
      rgb: { r, g, b },
    });
  }
  return colors;
};

export const createPortraitFixture = (width = 180, height = 180): ImageData => {
  const insideEllipse = (
    x: number,
    y: number,
    cx: number,
    cy: number,
    rx: number,
    ry: number,
  ) => (((x - cx) * (x - cx)) / (rx * rx)) + (((y - cy) * (y - cy)) / (ry * ry)) <= 1;

  const scaleX = width / 180;
  const scaleY = height / 180;
  const sx = (value: number) => value * scaleX;
  const sy = (value: number) => value * scaleY;
  const px = (value: number) => Math.round(value * scaleX);
  const py = (value: number) => Math.round(value * scaleY);

  return createImageData(width, height, (x, y) => {
    const head = insideEllipse(x, y, sx(90), sy(78), sx(44), sy(54));
    const neck = x >= px(78) && x <= px(102) && y >= py(112) && y <= py(136);
    const shirt = y >= py(124) && x >= px(12) && x <= px(168);
    const shirtShadow = shirt && (x >= px(100) || y >= py(150));
    const hair = insideEllipse(x, y, sx(90), sy(58), sx(54), sy(38));
    const hairShadow = hair && (x < px(88) || y < py(46));
    const leftFrame = x >= px(50) && x <= px(74) && y >= py(65) && y <= py(87) && (
      x === px(50) || x === px(74) || y === py(65) || y === py(87)
    );
    const rightFrame = x >= px(106) && x <= px(130) && y >= py(65) && y <= py(87) && (
      x === px(106) || x === px(130) || y === py(65) || y === py(87)
    );
    const bridge = y >= py(74) && y <= py(78) && x >= px(74) && x <= px(106);
    const leftEye = insideEllipse(x, y, sx(62), sy(76), sx(9), sy(6));
    const rightEye = insideEllipse(x, y, sx(118), sy(76), sx(9), sy(6));
    const leftPupil = insideEllipse(x, y, sx(64), sy(76), sx(2), sy(2));
    const rightPupil = insideEllipse(x, y, sx(120), sy(76), sx(2), sy(2));
    const browLeft = y >= py(58) && y <= py(61) && x >= px(48) && x <= px(74);
    const browRight = y >= py(58) && y <= py(61) && x >= px(104) && x <= px(130);
    const nose = x >= px(86) && x <= px(92) && y >= py(86) && y <= py(104);
    const mouth = y >= py(118) && y <= py(120) && x >= px(70) && x <= px(110);
    const jawLine = y >= py(122) && y <= py(126) && x >= px(48) && x <= px(132);
    const cheekShade = head && y >= py(92) && x >= px(104);

    if (leftFrame || rightFrame || bridge || leftPupil || rightPupil || mouth || (nose && x <= px(89))) {
      return { r: 24, g: 20, b: 22 };
    }

    if (jawLine && (x <= px(56) || x >= px(124) || y >= py(125))) {
      return { r: 122, g: 86, b: 92 };
    }

    if (leftEye || rightEye) {
      return { r: 252, g: 250, b: 255 };
    }

    if (browLeft || browRight) {
      return { r: 90, g: 64, b: 58 };
    }

    if (hairShadow) {
      return { r: 94 + (x % 3), g: 66 + (y % 2), b: 58 + ((x + y) % 3) };
    }

    if (hair) {
      return { r: 112 + (x % 3), g: 83 + (y % 2), b: 73 + ((x + y) % 2) };
    }

    if (shirtShadow) {
      return { r: 106 + (x % 2), g: 110 + (y % 2), b: 112 + ((x + y) % 2) };
    }

    if (shirt) {
      return { r: 132 + (x % 2), g: 136 + (y % 2), b: 138 + ((x + y) % 2) };
    }

    if (cheekShade) {
      return { r: 226, g: 176, b: 146 };
    }

    if (head || neck) {
      return { r: 236, g: 190, b: 156 };
    }

    return { r: 255, g: 255, b: 255, a: 0 };
  });
};

export const countBrightCells = (cells: GridCell[][]): number => {
  let total = 0;
  for (const row of cells) {
    for (const cell of row) {
      if (!cell) continue;
      if (cell.rgb.r >= 210 && cell.rgb.g >= 210 && cell.rgb.b >= 210) {
        total++;
      }
    }
  }
  return total;
};

export const countDarkCells = (cells: GridCell[][]): number => {
  let total = 0;
  for (const row of cells) {
    for (const cell of row) {
      if (!cell) continue;
      if (cell.rgb.r <= 80 && cell.rgb.g <= 80 && cell.rgb.b <= 80) {
        total++;
      }
    }
  }
  return total;
};

export const countUniqueCellColors = (cells: GridCell[][]): number => {
  const seen = new Set<string>();
  for (const row of cells) {
    for (const cell of row) {
      if (cell) {
        seen.add(cell.hex);
      }
    }
  }
  return seen.size;
};
