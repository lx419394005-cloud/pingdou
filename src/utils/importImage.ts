const BYTES_PER_MB = 1024 * 1024;

export const MAX_IMPORT_IMAGE_SIZE_MB = 10;
export const MAX_IMPORT_IMAGE_SIZE_BYTES = MAX_IMPORT_IMAGE_SIZE_MB * BYTES_PER_MB;

export const isImportImageSizeValid = (file: Pick<File, 'size'>) => (
  file.size <= MAX_IMPORT_IMAGE_SIZE_BYTES
);

export const getImportImageSizeError = (file: Pick<File, 'name' | 'size'>) => {
  const currentSizeMb = (file.size / BYTES_PER_MB).toFixed(1);
  return `图片大小超出限制：${file.name}（${currentSizeMb}MB）。请上传不超过 ${MAX_IMPORT_IMAGE_SIZE_MB}MB 的图片。`;
};
