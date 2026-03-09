export interface OpaqueBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

const makeImageData = (data: Uint8ClampedArray, width: number, height: number): ImageData => {
  if (typeof ImageData !== 'undefined') {
    return new ImageData(Uint8ClampedArray.from(data), width, height);
  }

  return { width, height, data } as ImageData;
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
