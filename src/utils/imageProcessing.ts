export interface OpaqueBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface PixelPoint {
  x: number;
  y: number;
}

export interface PreviewCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropSourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const IMPORT_ZOOM_MIN_SCALE = 0.05;
export const IMPORT_ZOOM_MAX_SCALE = 4;

const makeImageData = (data: Uint8ClampedArray, width: number, height: number): ImageData => {
  if (typeof ImageData !== 'undefined') {
    return new ImageData(Uint8ClampedArray.from(data), width, height);
  }

  return { width, height, data } as ImageData;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const resolveZoomRange = (minScale: number, maxScale: number) => {
  const safeMin = Math.min(minScale, maxScale);
  const safeMax = Math.max(minScale, maxScale);

  return {
    min: Math.max(0.01, safeMin),
    max: Math.max(Math.max(0.01, safeMin), safeMax),
  };
};

const isNearWhite = (data: Uint8ClampedArray, pixelIndex: number, threshold: number) => {
  const idx = pixelIndex * 4;
  return (
    data[idx + 3] >= 8 &&
    data[idx] >= threshold &&
    data[idx + 1] >= threshold &&
    data[idx + 2] >= threshold
  );
};

const isPointInsidePolygon = (x: number, y: number, points: PixelPoint[]) => {
  let inside = false;

  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i]?.x ?? 0;
    const yi = points[i]?.y ?? 0;
    const xj = points[j]?.x ?? 0;
    const yj = points[j]?.y ?? 0;

    const intersects = ((yi > y) !== (yj > y))
      && (x < (((xj - xi) * (y - yi)) / ((yj - yi) || 1e-7)) + xi);

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
};

const getPixelOffset = (width: number, x: number, y: number) => ((y * width) + x) * 4;

const getPixelColor = (data: Uint8ClampedArray, width: number, x: number, y: number) => {
  const idx = getPixelOffset(width, x, y);
  return {
    r: data[idx],
    g: data[idx + 1],
    b: data[idx + 2],
    a: data[idx + 3],
  };
};

const getColorDistanceSquared = (
  left: { r: number; g: number; b: number },
  right: { r: number; g: number; b: number },
) => {
  const dr = left.r - right.r;
  const dg = left.g - right.g;
  const db = left.b - right.b;
  return (dr * dr) + (dg * dg) + (db * db);
};

export const sliderValueToZoomScale = (
  sliderValue: number,
  minScale = IMPORT_ZOOM_MIN_SCALE,
  maxScale = IMPORT_ZOOM_MAX_SCALE,
) => {
  const { min, max } = resolveZoomRange(minScale, maxScale);
  const t = clamp(sliderValue, 0, 100) / 100;

  if (max <= 1 || min >= 1) {
    return Number((min + ((max - min) * t)).toFixed(4));
  }

  let scale: number;
  if (t <= 0.5) {
    const local = t / 0.5;
    scale = min * ((1 / min) ** local);
  } else {
    const local = (t - 0.5) / 0.5;
    scale = max ** local;
  }

  return Number(clamp(scale, min, max).toFixed(4));
};

export const zoomScaleToSliderValue = (
  scale: number,
  minScale = IMPORT_ZOOM_MIN_SCALE,
  maxScale = IMPORT_ZOOM_MAX_SCALE,
) => {
  const { min, max } = resolveZoomRange(minScale, maxScale);
  const clamped = clamp(scale, min, max);

  if (max <= 1 || min >= 1) {
    const t = (clamped - min) / Math.max(0.0001, max - min);
    return Number((clamp(t, 0, 1) * 100).toFixed(4));
  }

  let t: number;
  if (clamped <= 1) {
    const local = Math.log(clamped / min) / Math.log(1 / min);
    t = 0.5 * local;
  } else {
    const local = Math.log(clamped) / Math.log(max);
    t = 0.5 + (0.5 * local);
  }

  return Number((clamp(t, 0, 1) * 100).toFixed(4));
};

export const removeConnectedWhiteBackground = (
  imageData: ImageData,
  threshold = 245,
): ImageData => {
  const { width, height, data } = imageData;
  const next = new Uint8ClampedArray(data);
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];

  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return;
    }

    const pixelIndex = (y * width) + x;
    if (visited[pixelIndex] || !isNearWhite(next, pixelIndex, threshold)) {
      return;
    }

    visited[pixelIndex] = 1;
    queue.push(pixelIndex);
  };

  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }

  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }

  while (queue.length > 0) {
    const pixelIndex = queue.shift() as number;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    const alphaIndex = (pixelIndex * 4) + 3;

    next[alphaIndex] = 0;

    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  return makeImageData(next, width, height);
};

export const removeEdgeConnectedBackgroundByColor = (
  imageData: ImageData,
  threshold = 42,
): ImageData => {
  const { width, height, data } = imageData;
  const next = new Uint8ClampedArray(data);
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  let queueHead = 0;
  const thresholdSquared = threshold * threshold;

  let borderCount = 0;
  let borderR = 0;
  let borderG = 0;
  let borderB = 0;

  const collectBorderColor = (x: number, y: number) => {
    const idx = (y * width + x) * 4;
    if (next[idx + 3] < 8) {
      return;
    }

    borderR += next[idx];
    borderG += next[idx + 1];
    borderB += next[idx + 2];
    borderCount += 1;
  };

  for (let x = 0; x < width; x++) {
    collectBorderColor(x, 0);
    if (height > 1) {
      collectBorderColor(x, height - 1);
    }
  }

  for (let y = 1; y < height - 1; y++) {
    collectBorderColor(0, y);
    if (width > 1) {
      collectBorderColor(width - 1, y);
    }
  }

  if (borderCount === 0) {
    return makeImageData(next, width, height);
  }

  const avgR = borderR / borderCount;
  const avgG = borderG / borderCount;
  const avgB = borderB / borderCount;

  const isBackgroundLike = (pixelIndex: number) => {
    const idx = pixelIndex * 4;
    if (next[idx + 3] < 8) {
      return false;
    }

    const dr = next[idx] - avgR;
    const dg = next[idx + 1] - avgG;
    const db = next[idx + 2] - avgB;
    return ((dr * dr) + (dg * dg) + (db * db)) <= thresholdSquared;
  };

  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return;
    }

    const pixelIndex = (y * width) + x;
    if (visited[pixelIndex] || !isBackgroundLike(pixelIndex)) {
      return;
    }

    visited[pixelIndex] = 1;
    queue.push(pixelIndex);
  };

  for (let x = 0; x < width; x++) {
    push(x, 0);
    if (height > 1) {
      push(x, height - 1);
    }
  }

  for (let y = 1; y < height - 1; y++) {
    push(0, y);
    if (width > 1) {
      push(width - 1, y);
    }
  }

  while (queueHead < queue.length) {
    const pixelIndex = queue[queueHead] as number;
    queueHead += 1;

    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    const alphaIndex = (pixelIndex * 4) + 3;

    next[alphaIndex] = 0;

    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  return makeImageData(next, width, height);
};

export const cropImageData = (
  imageData: ImageData,
  rect: PixelRect,
): ImageData => {
  const x = clamp(Math.floor(rect.x), 0, imageData.width - 1);
  const y = clamp(Math.floor(rect.y), 0, imageData.height - 1);
  const width = clamp(Math.round(rect.width), 1, imageData.width - x);
  const height = clamp(Math.round(rect.height), 1, imageData.height - y);
  const next = new Uint8ClampedArray(width * height * 4);

  for (let row = 0; row < height; row++) {
    const sourceStart = getPixelOffset(imageData.width, x, y + row);
    const targetStart = row * width * 4;
    next.set(imageData.data.slice(sourceStart, sourceStart + (width * 4)), targetStart);
  }

  return makeImageData(next, width, height);
};

export const applySeededCutout = (
  imageData: ImageData,
  seeds: PixelPoint[],
  mode: 'keep' | 'remove',
  options?: {
    tolerance?: number;
    radius?: number;
  },
): ImageData => {
  const { width, height, data } = imageData;
  const next = new Uint8ClampedArray(data);
  const selected = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);
  const queue: Array<{ x: number; y: number }> = [];
  let queueHead = 0;
  const toleranceSquared = (options?.tolerance ?? 38) ** 2;
  const radius = Math.max(0, Math.round(options?.radius ?? 1));
  let targetColor: { r: number; g: number; b: number } | null = null;

  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return;
    }

    const pixelIndex = (y * width) + x;
    if (visited[pixelIndex]) {
      return;
    }

    const color = getPixelColor(next, width, x, y);
    if (!targetColor || color.a < 8 || getColorDistanceSquared(color, targetColor) > toleranceSquared) {
      return;
    }

    visited[pixelIndex] = 1;
    queue.push({ x, y });
  };

  for (const seed of seeds) {
    const baseX = clamp(Math.round(seed.x), 0, width - 1);
    const baseY = clamp(Math.round(seed.y), 0, height - 1);
    const baseColor = getPixelColor(next, width, baseX, baseY);
    if (baseColor.a < 8) {
      continue;
    }

    if (!targetColor) {
      targetColor = {
        r: baseColor.r,
        g: baseColor.g,
        b: baseColor.b,
      };
    }

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if ((dx * dx) + (dy * dy) > radius * radius) {
          continue;
        }
        push(baseX + dx, baseY + dy);
      }
    }
  }

  if (!targetColor) {
    return makeImageData(next, width, height);
  }

  while (queueHead < queue.length) {
    const current = queue[queueHead] as { x: number; y: number };
    queueHead += 1;

    selected[(current.y * width) + current.x] = 1;

    push(current.x + 1, current.y);
    push(current.x - 1, current.y);
    push(current.x, current.y + 1);
    push(current.x, current.y - 1);
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIndex = (y * width) + x;
      const alphaIndex = (pixelIndex * 4) + 3;
      const isSelected = selected[pixelIndex] === 1;

      if (mode === 'keep' && !isSelected) {
        next[alphaIndex] = 0;
      }

      if (mode === 'remove' && isSelected) {
        next[alphaIndex] = 0;
      }
    }
  }

  return makeImageData(next, width, height);
};

export const applySeededRestore = (
  imageData: ImageData,
  sourceImageData: ImageData,
  seeds: PixelPoint[],
  options?: {
    tolerance?: number;
    radius?: number;
  },
): ImageData => {
  const { width, height, data } = imageData;
  if (sourceImageData.width !== width || sourceImageData.height !== height) {
    return makeImageData(new Uint8ClampedArray(data), width, height);
  }

  const next = new Uint8ClampedArray(data);
  const selected = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);
  const queue: Array<{ x: number; y: number }> = [];
  let queueHead = 0;
  const toleranceSquared = (options?.tolerance ?? 38) ** 2;
  const radius = Math.max(0, Math.round(options?.radius ?? 1));
  let targetColor: { r: number; g: number; b: number } | null = null;

  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return;
    }

    const pixelIndex = (y * width) + x;
    if (visited[pixelIndex]) {
      return;
    }

    const color = getPixelColor(sourceImageData.data, width, x, y);
    if (!targetColor || color.a < 8 || getColorDistanceSquared(color, targetColor) > toleranceSquared) {
      return;
    }

    visited[pixelIndex] = 1;
    queue.push({ x, y });
  };

  for (const seed of seeds) {
    const baseX = clamp(Math.round(seed.x), 0, width - 1);
    const baseY = clamp(Math.round(seed.y), 0, height - 1);
    const baseColor = getPixelColor(sourceImageData.data, width, baseX, baseY);
    if (baseColor.a < 8) {
      continue;
    }

    if (!targetColor) {
      targetColor = {
        r: baseColor.r,
        g: baseColor.g,
        b: baseColor.b,
      };
    }

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if ((dx * dx) + (dy * dy) > radius * radius) {
          continue;
        }
        push(baseX + dx, baseY + dy);
      }
    }
  }

  if (!targetColor) {
    return makeImageData(next, width, height);
  }

  while (queueHead < queue.length) {
    const current = queue[queueHead] as { x: number; y: number };
    queueHead += 1;

    selected[(current.y * width) + current.x] = 1;
    push(current.x + 1, current.y);
    push(current.x - 1, current.y);
    push(current.x, current.y + 1);
    push(current.x, current.y - 1);
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIndex = (y * width) + x;
      if (!selected[pixelIndex]) {
        continue;
      }

      const sourceIndex = pixelIndex * 4;
      next[sourceIndex] = sourceImageData.data[sourceIndex];
      next[sourceIndex + 1] = sourceImageData.data[sourceIndex + 1];
      next[sourceIndex + 2] = sourceImageData.data[sourceIndex + 2];
      next[sourceIndex + 3] = sourceImageData.data[sourceIndex + 3];
    }
  }

  return makeImageData(next, width, height);
};

export const applyPolygonCutout = (
  imageData: ImageData,
  points: PixelPoint[],
  mode: 'keep' | 'remove',
): ImageData => {
  const { width, height, data } = imageData;
  const next = new Uint8ClampedArray(data);

  if (points.length < 3) {
    return makeImageData(next, width, height);
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = isPointInsidePolygon(x + 0.5, y + 0.5, points);
      const alphaIndex = ((y * width + x) * 4) + 3;

      if (mode === 'keep' && !inside) {
        next[alphaIndex] = 0;
      } else if (mode === 'remove' && inside) {
        next[alphaIndex] = 0;
      }
    }
  }

  return makeImageData(next, width, height);
};

export const findOpaqueBounds = (imageData: ImageData): OpaqueBounds | null => {
  const { width, height, data } = imageData;
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[((y * width + x) * 4) + 3];
      if (alpha < 8) {
        continue;
      }

      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < left || bottom < top) {
    return null;
  }

  return {
    left,
    top,
    right,
    bottom,
    width: (right - left) + 1,
    height: (bottom - top) + 1,
  };
};

export const expandBounds = (
  bounds: OpaqueBounds,
  padding: number,
  maxWidth: number,
  maxHeight: number,
): OpaqueBounds => {
  const left = Math.max(0, bounds.left - padding);
  const top = Math.max(0, bounds.top - padding);
  const right = Math.min(maxWidth - 1, bounds.right + padding);
  const bottom = Math.min(maxHeight - 1, bounds.bottom + padding);

  return {
    left,
    top,
    right,
    bottom,
    width: (right - left) + 1,
    height: (bottom - top) + 1,
  };
};

export const computeCropSourceRect = (
  cropRect: PreviewCropRect,
  offset: { x: number; y: number },
  scale: number,
  imageWidth: number,
  imageHeight: number,
): CropSourceRect | null => {
  const safeScale = Math.max(0.01, scale);
  const sourceLeft = (cropRect.x - offset.x) / safeScale;
  const sourceTop = (cropRect.y - offset.y) / safeScale;
  const sourceRight = sourceLeft + (cropRect.width / safeScale);
  const sourceBottom = sourceTop + (cropRect.height / safeScale);

  const clippedLeft = clamp(sourceLeft, 0, imageWidth);
  const clippedTop = clamp(sourceTop, 0, imageHeight);
  const clippedRight = clamp(sourceRight, 0, imageWidth);
  const clippedBottom = clamp(sourceBottom, 0, imageHeight);

  if (clippedRight <= clippedLeft || clippedBottom <= clippedTop) {
    return null;
  }

  const sx = Math.floor(clippedLeft);
  const sy = Math.floor(clippedTop);
  const ex = Math.ceil(clippedRight);
  const ey = Math.ceil(clippedBottom);

  return {
    sx,
    sy,
    sw: Math.max(1, ex - sx),
    sh: Math.max(1, ey - sy),
  };
};
