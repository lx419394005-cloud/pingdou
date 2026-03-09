import { describe, expect, it } from 'vitest';
import {
  MAX_IMPORT_IMAGE_SIZE_BYTES,
  MAX_IMPORT_IMAGE_SIZE_MB,
  getImportImageSizeError,
  isImportImageSizeValid,
} from './importImage';

describe('importImage', () => {
  it('accepts files at or below the maximum configured size', () => {
    expect(isImportImageSizeValid({ size: MAX_IMPORT_IMAGE_SIZE_BYTES })).toBe(true);
    expect(isImportImageSizeValid({ size: MAX_IMPORT_IMAGE_SIZE_BYTES - 1 })).toBe(true);
  });

  it('rejects files larger than the maximum configured size', () => {
    expect(isImportImageSizeValid({ size: MAX_IMPORT_IMAGE_SIZE_BYTES + 1 })).toBe(false);
  });

  it('builds a human readable validation message', () => {
    const message = getImportImageSizeError({
      name: 'huge-image.png',
      size: MAX_IMPORT_IMAGE_SIZE_BYTES + 12,
    });

    expect(message).toContain('huge-image.png');
    expect(message).toContain(`${MAX_IMPORT_IMAGE_SIZE_MB}MB`);
  });
});
