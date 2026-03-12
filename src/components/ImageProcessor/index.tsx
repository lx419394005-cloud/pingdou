import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AlgorithmMode, Color, GridConfig, GridCell } from '../../types';
import {
  estimateRecommendedColorLimit,
  MAX_TARGET_COLORS,
  MIN_TARGET_COLORS,
  processImageToGrid,
} from '../../algorithms/kMeans';
import {
  applySeededCutout,
  applySeededRestore,
  cropImageData,
  expandBounds,
  findOpaqueBounds,
  IMPORT_ZOOM_MAX_SCALE,
  IMPORT_ZOOM_MIN_SCALE,
  type PixelRect,
  removeConnectedWhiteBackground,
  removeEdgeConnectedBackgroundByColor,
  sliderValueToZoomScale,
  zoomScaleToSliderValue,
} from '../../utils/imageProcessing';
import { getImportImageSizeError, isImportImageSizeValid } from '../../utils/importImage';
import {
  IMAGE_PROCESSOR_FOOTER_ACTIONS,
  IMAGE_PROCESSOR_HISTORY_ACTIONS,
  IMAGE_PROCESSOR_TOOL_BUTTONS,
  type HistoryActionId,
  type ToolButtonConfig,
  type ToolButtonId,
} from './config';

 interface ImageProcessorProps {
  palette: Color[] | null;
  targetConfig: GridConfig;
  onGridLoaded: (cells: GridCell[][], width: number, height: number, overlayImage: string | null) => void;
  variant?: 'panel' | 'modal';
  initialImageFile?: File | null;
  initialPreviewImageUrl?: string | null;
  onRequestImageFile?: () => void;
  enableExperimentalModes?: boolean;
  defaultAlgorithmMode?: AlgorithmMode;
  defaultWorkingResolution?: number;
  onProcessed?: () => void;
  onPreviewChange?: (previewImage: string | null) => void;
  onColorControlsChange?: (controls: {
    hasImage: boolean;
    targetColorMode: 'auto' | 'manual';
    recommendedTargetColors: number;
    selectedTargetColors: number;
    minTargetColors: number;
    maxTargetColors: number;
    applyAutoTargetColors: () => void;
    applyManualTargetColors: (value: number) => void;
  }) => void;
  onStatusChange?: (status: {
    sourceName: string | null;
    algorithmMode: AlgorithmMode;
    hasReference: boolean;
    workingResolution: number;
  }) => void;
}

interface PreviewPoint {
  x: number;
  y: number;
}

type EditMode = 'crop' | 'move' | 'brush-restore' | 'brush-remove';
type CropHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';
type DragState =
  | {
    kind: 'move';
    startPoint: PreviewPoint;
    startOffset: { x: number; y: number };
  }
  | {
    kind: 'crop';
    handle: CropHandle;
    startPoint: PreviewPoint;
    startBox: PixelRect;
  }
  | null;

interface PreviewCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const PREVIEW_SIZE = 280;
const PREVIEW_PADDING = 20;
const WORKING_RESOLUTION_OPTIONS = [120, 160, 200];
const INK_THRESHOLD_MIN = 0;
const INK_THRESHOLD_MAX = 100;
const TRACE_OVERLAY_SCALE = 12;
const TRACE_OVERLAY_MAX_SIZE = 1200;
const FREE_CROP_PADDING = 14;
const FREE_CROP_MIN_SIZE = 24;
const FREE_CROP_HIT_RADIUS = 12;
const BRUSH_PREVIEW_RADIUS = 10;
const SMART_CUTOUT_TOLERANCE = 44;
const MAX_IMPORT_EDIT_HISTORY = 20;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const clampImportScale = (value: number) => Math.min(
  IMPORT_ZOOM_MAX_SCALE,
  Math.max(IMPORT_ZOOM_MIN_SCALE, Number(value.toFixed(4))),
);

const cloneImageData = (imageData: ImageData): ImageData => (
  new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height)
);

const getToneClasses = (tone: ToolButtonConfig['tone'], active: boolean) => {
  if (active) {
    if (tone === 'amber') return 'border-amber-500 bg-amber-500 text-white shadow-[0_10px_24px_rgba(245,158,11,0.28)]';
    if (tone === 'slate') return 'border-slate-700 bg-slate-700 text-white shadow-[0_10px_24px_rgba(51,65,85,0.24)]';
    if (tone === 'emerald') return 'border-emerald-500 bg-emerald-500 text-white shadow-[0_10px_24px_rgba(16,185,129,0.24)]';
    if (tone === 'rose') return 'border-rose-500 bg-rose-500 text-white shadow-[0_10px_24px_rgba(244,63,94,0.24)]';
    return 'border-sky-500 bg-sky-500 text-white shadow-[0_10px_24px_rgba(14,165,233,0.24)]';
  }

  if (tone === 'amber') return 'border-[#ecdac2] bg-white text-[#8d5a24] hover:border-amber-300 hover:bg-amber-50';
  if (tone === 'slate') return 'border-[#d9dde5] bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50';
  if (tone === 'emerald') return 'border-[#d3ece3] bg-white text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50';
  if (tone === 'rose') return 'border-[#f1d6dd] bg-white text-rose-700 hover:border-rose-300 hover:bg-rose-50';
  return 'border-[#d2eaf4] bg-white text-sky-700 hover:border-sky-300 hover:bg-sky-50';
};

const getCropRect = (width: number, height: number): PreviewCropRect => {
  const usable = PREVIEW_SIZE - (PREVIEW_PADDING * 2);
  const aspect = width / Math.max(1, height);

  if (aspect >= 1) {
    const cropWidth = usable;
    const cropHeight = usable / aspect;
    return {
      x: PREVIEW_PADDING,
      y: (PREVIEW_SIZE - cropHeight) / 2,
      width: cropWidth,
      height: cropHeight,
    };
  }

  const cropHeight = usable;
  const cropWidth = usable * aspect;
  return {
    x: (PREVIEW_SIZE - cropWidth) / 2,
    y: PREVIEW_PADDING,
    width: cropWidth,
    height: cropHeight,
  };
};

const getContainRect = (width: number, height: number): PixelRect => {
  const usable = PREVIEW_SIZE - (FREE_CROP_PADDING * 2);
  const aspect = width / Math.max(1, height);

  if (aspect >= 1) {
    const rectWidth = usable;
    const rectHeight = usable / aspect;
    return {
      x: FREE_CROP_PADDING,
      y: (PREVIEW_SIZE - rectHeight) / 2,
      width: rectWidth,
      height: rectHeight,
    };
  }

  const rectHeight = usable;
  const rectWidth = usable * aspect;
  return {
    x: (PREVIEW_SIZE - rectWidth) / 2,
    y: FREE_CROP_PADDING,
    width: rectWidth,
    height: rectHeight,
  };
};

const getFittedTransform = (
  bounds: ReturnType<typeof findOpaqueBounds>,
  cropRect: PreviewCropRect,
  imageWidth: number,
  imageHeight: number,
) => {
  const effectiveBounds = bounds ?? {
    left: 0,
    top: 0,
    right: imageWidth - 1,
    bottom: imageHeight - 1,
    width: imageWidth,
    height: imageHeight,
  };
  const scale = Math.min(
    cropRect.width / effectiveBounds.width,
    cropRect.height / effectiveBounds.height,
  );

  return {
    scale,
    offset: {
      x: cropRect.x + ((cropRect.width - (effectiveBounds.width * scale)) / 2) - (effectiveBounds.left * scale),
      y: cropRect.y + ((cropRect.height - (effectiveBounds.height * scale)) / 2) - (effectiveBounds.top * scale),
    },
  };
};

const getInitialFreeCropBox = (
  imageWidth: number,
  imageHeight: number,
  bounds: ReturnType<typeof findOpaqueBounds>,
): PixelRect => {
  if (!bounds) {
    return { x: 0, y: 0, width: imageWidth, height: imageHeight };
  }

  const expanded = expandBounds(bounds, 18, imageWidth, imageHeight);
  return {
    x: expanded.left,
    y: expanded.top,
    width: expanded.width,
    height: expanded.height,
  };
};

const mapImagePointToPreview = (
  point: PreviewPoint,
  displayRect: PixelRect,
  imageWidth: number,
  imageHeight: number,
): PreviewPoint => ({
  x: displayRect.x + ((point.x / imageWidth) * displayRect.width),
  y: displayRect.y + ((point.y / imageHeight) * displayRect.height),
});

const mapPreviewPointToImage = (
  point: PreviewPoint,
  displayRect: PixelRect,
  imageWidth: number,
  imageHeight: number,
): PreviewPoint | null => {
  if (
    point.x < displayRect.x
    || point.y < displayRect.y
    || point.x > displayRect.x + displayRect.width
    || point.y > displayRect.y + displayRect.height
  ) {
    return null;
  }

  return {
    x: ((point.x - displayRect.x) / displayRect.width) * imageWidth,
    y: ((point.y - displayRect.y) / displayRect.height) * imageHeight,
  };
};

const mapImageRectToPreviewRect = (
  rect: PixelRect,
  displayRect: PixelRect,
  imageWidth: number,
  imageHeight: number,
): PixelRect => {
  const topLeft = mapImagePointToPreview({ x: rect.x, y: rect.y }, displayRect, imageWidth, imageHeight);
  const bottomRight = mapImagePointToPreview(
    { x: rect.x + rect.width, y: rect.y + rect.height },
    displayRect,
    imageWidth,
    imageHeight,
  );

  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
};

const getCropHandleAtPoint = (point: PreviewPoint, cropPreviewRect: PixelRect): CropHandle | null => {
  const left = cropPreviewRect.x;
  const right = cropPreviewRect.x + cropPreviewRect.width;
  const top = cropPreviewRect.y;
  const bottom = cropPreviewRect.y + cropPreviewRect.height;
  const centerX = left + (cropPreviewRect.width / 2);
  const centerY = top + (cropPreviewRect.height / 2);

  const near = (a: number, b: number) => Math.abs(a - b) <= FREE_CROP_HIT_RADIUS;
  const withinX = point.x >= left && point.x <= right;
  const withinY = point.y >= top && point.y <= bottom;

  if (near(point.x, left) && near(point.y, top)) return 'nw';
  if (near(point.x, right) && near(point.y, top)) return 'ne';
  if (near(point.x, left) && near(point.y, bottom)) return 'sw';
  if (near(point.x, right) && near(point.y, bottom)) return 'se';
  if (near(point.y, top) && Math.abs(point.x - centerX) <= 28) return 'n';
  if (near(point.y, bottom) && Math.abs(point.x - centerX) <= 28) return 's';
  if (near(point.x, left) && Math.abs(point.y - centerY) <= 28) return 'w';
  if (near(point.x, right) && Math.abs(point.y - centerY) <= 28) return 'e';
  if (withinX && withinY) return 'move';
  return null;
};

const resizeCropBox = (
  startBox: PixelRect,
  handle: CropHandle,
  deltaX: number,
  deltaY: number,
  imageWidth: number,
  imageHeight: number,
): PixelRect => {
  if (handle === 'move') {
    return {
      x: clamp(startBox.x + deltaX, 0, imageWidth - startBox.width),
      y: clamp(startBox.y + deltaY, 0, imageHeight - startBox.height),
      width: startBox.width,
      height: startBox.height,
    };
  }

  let left = startBox.x;
  let right = startBox.x + startBox.width;
  let top = startBox.y;
  let bottom = startBox.y + startBox.height;

  if (handle.includes('w')) {
    left += deltaX;
  }
  if (handle.includes('e')) {
    right += deltaX;
  }
  if (handle.includes('n')) {
    top += deltaY;
  }
  if (handle.includes('s')) {
    bottom += deltaY;
  }

  if (right - left < FREE_CROP_MIN_SIZE) {
    if (handle.includes('w')) {
      left = right - FREE_CROP_MIN_SIZE;
    } else {
      right = left + FREE_CROP_MIN_SIZE;
    }
  }

  if (bottom - top < FREE_CROP_MIN_SIZE) {
    if (handle.includes('n')) {
      top = bottom - FREE_CROP_MIN_SIZE;
    } else {
      bottom = top + FREE_CROP_MIN_SIZE;
    }
  }

  left = clamp(left, 0, imageWidth - FREE_CROP_MIN_SIZE);
  top = clamp(top, 0, imageHeight - FREE_CROP_MIN_SIZE);
  right = clamp(right, left + FREE_CROP_MIN_SIZE, imageWidth);
  bottom = clamp(bottom, top + FREE_CROP_MIN_SIZE, imageHeight);

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
};

const getToolIcon = (id: ToolButtonId, className = 'h-4 w-4') => {
  if (id === 'crop') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M7 3v10a4 4 0 004 4h10" />
        <path d="M17 3v4" />
        <path d="M3 7h4" />
        <path d="M14 14l7 7" />
      </svg>
    );
  }
  if (id === 'brush-restore') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 5l5 5" />
        <path d="M4 20l4-1 10-10-3-3L5 16l-1 4z" />
        <path d="M18 17v6" />
        <path d="M15 20h6" />
      </svg>
    );
  }
  if (id === 'brush-remove') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 5l5 5" />
        <path d="M4 20l4-1 10-10-3-3L5 16l-1 4z" />
        <path d="M16 19h6" />
      </svg>
    );
  }
  if (id === 'auto-cutout') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" />
        <path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z" />
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 14c3-2.5 5-3 8-3 4.5 0 7.5-2 8-7" />
      <path d="M6 18c1.4 0 2.5-1.1 2.5-2.5S7.4 13 6 13s-2.5 1.1-2.5 2.5S4.6 18 6 18z" />
      <path d="M18 8c1.4 0 2.5-1.1 2.5-2.5S19.4 3 18 3s-2.5 1.1-2.5 2.5S16.6 8 18 8z" />
    </svg>
  );
};

const getMiniIcon = (kind: 'spark' | 'manual' | 'grid' | 'refresh' | 'play' | 'check' | 'close' | 'image' | 'undo', className = 'h-4 w-4') => {
  if (kind === 'spark') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 3l1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4L12 3z" />
      </svg>
    );
  }
  if (kind === 'manual') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M6 4h12" />
        <path d="M6 10h12" />
        <path d="M6 16h7" />
      </svg>
    );
  }
  if (kind === 'grid') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M12 4v16" />
        <path d="M4 12h16" />
      </svg>
    );
  }
  if (kind === 'refresh') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 11a8 8 0 10-2.3 5.6" />
        <path d="M20 4v7h-7" />
      </svg>
    );
  }
  if (kind === 'play') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 6l10 6-10 6V6z" />
      </svg>
    );
  }
  if (kind === 'check') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  if (kind === 'close') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M6 6l12 12" />
        <path d="M18 6L6 18" />
      </svg>
    );
  }
  if (kind === 'undo') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 14L4 9l5-5" />
        <path d="M20 20a9 9 0 0 0-9-9H4" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="M21 15l-5-5-8 8" />
    </svg>
  );
};

export const ImageProcessor: React.FC<ImageProcessorProps> = ({
  palette,
  targetConfig,
  onGridLoaded,
  variant = 'panel',
  initialImageFile = null,
  initialPreviewImageUrl = null,
  onRequestImageFile,
  enableExperimentalModes = false,
  defaultAlgorithmMode = 'legacy-clean',
  defaultWorkingResolution = 120,
  onProcessed,
  onPreviewChange,
  onColorControlsChange,
  onStatusChange,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const processingCanvasRef = useRef<HTMLCanvasElement>(null);
  const contourCanvasRef = useRef<HTMLCanvasElement>(null);
  const lastInitialFileRef = useRef<File | null>(null);
  const sourceImageDataRef = useRef<ImageData | null>(null);
  const editHistoryRef = useRef<ImageData[]>([]);

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [isLoadingImage, setIsLoadingImage] = useState(false);
  const [sourceName, setSourceName] = useState('');
  const [subjectBounds, setSubjectBounds] = useState<ReturnType<typeof findOpaqueBounds>>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragState, setDragState] = useState<DragState>(null);
  const [editMode, setEditMode] = useState<EditMode>('move');
  const [cropBox, setCropBox] = useState<PixelRect | null>(null);
  const [brushStroke, setBrushStroke] = useState<PreviewPoint[]>([]);
  const [isBrushing, setIsBrushing] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [canUndoEdit, setCanUndoEdit] = useState(false);
  const [algorithmMode, setAlgorithmMode] = useState<AlgorithmMode>(defaultAlgorithmMode);
  const [targetColorMode, setTargetColorMode] = useState<'auto' | 'manual'>('auto');
  const [recommendedTargetColors, setRecommendedTargetColors] = useState(6);
  const [manualTargetColors, setManualTargetColors] = useState(6);
  const [workingResolution, setWorkingResolution] = useState(defaultWorkingResolution);
  const [contourThreshold, setContourThreshold] = useState(50);

  const cropRect = useMemo(
    () => getCropRect(targetConfig.width, targetConfig.height),
    [targetConfig.height, targetConfig.width],
  );
  const freeCropDisplayRect = useMemo(
    () => (image ? getContainRect(image.width, image.height) : null),
    [image],
  );
  const zoomSliderValue = useMemo(() => zoomScaleToSliderValue(scale), [scale]);
  const isModal = variant === 'modal';

  const fitToSubject = useCallback(() => {
    if (!image) {
      return;
    }

    const fitted = getFittedTransform(subjectBounds, cropRect, image.width, image.height);
    setScale(clampImportScale(fitted.scale));
    setOffset(fitted.offset);
  }, [cropRect, image, subjectBounds]);

  const readImageData = useCallback(() => {
    if (!image) {
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }

    ctx.drawImage(image, 0, 0);
    return ctx.getImageData(0, 0, image.width, image.height);
  }, [image]);

  const applyImageDataUpdate = useCallback((
    nextImageData: ImageData,
    options?: {
      fitToSubjectAfter?: boolean;
      nextMode?: EditMode;
      updateSourceImageData?: boolean;
      resetHistory?: boolean;
    },
  ) => {
    const canvas = document.createElement('canvas');
    canvas.width = nextImageData.width;
    canvas.height = nextImageData.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.putImageData(nextImageData, 0, 0);
    const bounds = findOpaqueBounds(nextImageData);
    const previewUrl = canvas.toDataURL('image/png');
    const nextImage = new Image();
    nextImage.onload = () => {
      if (options?.updateSourceImageData) {
        sourceImageDataRef.current = cloneImageData(nextImageData);
      }
      if (options?.resetHistory) {
        editHistoryRef.current = [];
        setCanUndoEdit(false);
      }

      const expandedBounds = bounds ? expandBounds(bounds, 12, nextImage.width, nextImage.height) : bounds;
      setImage(nextImage);
      setSubjectBounds(expandedBounds);
      setCropBox(getInitialFreeCropBox(nextImage.width, nextImage.height, expandedBounds));

      if (options?.fitToSubjectAfter) {
        const fitted = getFittedTransform(expandedBounds, cropRect, nextImage.width, nextImage.height);
        setScale(clampImportScale(fitted.scale));
        setOffset(fitted.offset);
      } else {
        setScale((prev) => clampImportScale(prev));
      }

      setEditMode(options?.nextMode ?? 'move');
    };
    nextImage.src = previewUrl;
  }, [cropRect]);

  const renderToCanvas = useCallback((canvas: HTMLCanvasElement, width: number, height: number) => {
    if (!image) {
      return null;
    }

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }

    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    const scaleX = width / cropRect.width;
    const scaleY = height / cropRect.height;

    ctx.drawImage(
      image,
      (offset.x - cropRect.x) * scaleX,
      (offset.y - cropRect.y) * scaleY,
      image.width * scale * scaleX,
      image.height * scale * scaleY,
    );

    return ctx.getImageData(0, 0, width, height);
  }, [cropRect.height, cropRect.width, cropRect.x, cropRect.y, image, offset.x, offset.y, scale]);

  const getPreviewPoint = useCallback((event: { clientX: number; clientY: number }): PreviewPoint => {
    const canvas = previewCanvasRef.current;
    if (!canvas) {
      return { x: event.clientX, y: event.clientY };
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = PREVIEW_SIZE / Math.max(1, rect.width);
    const scaleY = PREVIEW_SIZE / Math.max(1, rect.height);
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }, []);

  const activePointerIdRef = useRef<number | null>(null);
  const activePointersRef = useRef(new Map<number, { clientX: number; clientY: number }>());
  const pinchRef = useRef<{ baseDistance: number; baseScale: number } | null>(null);

  const resetBrushState = useCallback(() => {
    setIsBrushing(false);
    setBrushStroke([]);
  }, []);

  const resetEditHistory = useCallback(() => {
    editHistoryRef.current = [];
    setCanUndoEdit(false);
  }, []);

  const pushEditHistory = useCallback((imageData: ImageData | null) => {
    if (!imageData) {
      return;
    }

    editHistoryRef.current = [
      ...editHistoryRef.current.slice(-(MAX_IMPORT_EDIT_HISTORY - 1)),
      cloneImageData(imageData),
    ];
    setCanUndoEdit(editHistoryRef.current.length > 0);
  }, []);

  const handleToolSelection = useCallback((toolId: ToolButtonId) => {
    if (toolId === 'auto-cutout') {
      const imageData = readImageData();
      if (!imageData) {
        return;
      }
      pushEditHistory(imageData);
      const cleaned = removeEdgeConnectedBackgroundByColor(imageData, 46);
      applyImageDataUpdate(cleaned, {
        fitToSubjectAfter: false,
        nextMode: 'move',
      });
      return;
    }

    resetBrushState();
    setDragState(null);

    if (toolId === 'crop') {
      if (image) {
        setCropBox((current) => current ?? getInitialFreeCropBox(image.width, image.height, subjectBounds));
      }
      setEditMode('crop');
      return;
    }

    setEditMode((current) => (current === toolId ? 'move' : toolId as EditMode));
  }, [applyImageDataUpdate, image, pushEditHistory, readImageData, resetBrushState, subjectBounds]);

  const commitBrushStroke = useCallback(() => {
    if (!isBrushing || brushStroke.length === 0 || !image) {
      resetBrushState();
      return;
    }

    const imageData = readImageData();
    if (!imageData) {
      resetBrushState();
      return;
    }

    const seeds = brushStroke
      .map((point) => ({
        x: (point.x - offset.x) / Math.max(0.01, scale),
        y: (point.y - offset.y) / Math.max(0.01, scale),
      }))
      .filter((point) => point.x >= 0 && point.y >= 0 && point.x < image.width && point.y < image.height);

    if (seeds.length === 0) {
      resetBrushState();
      return;
    }

    pushEditHistory(imageData);
    const brushRadius = Math.max(1, Math.round(BRUSH_PREVIEW_RADIUS / Math.max(0.4, scale)));
    const next = editMode === 'brush-restore'
      ? applySeededRestore(
        imageData,
        sourceImageDataRef.current ?? imageData,
        seeds,
        {
          tolerance: SMART_CUTOUT_TOLERANCE,
          radius: brushRadius,
        },
      )
      : applySeededCutout(
        imageData,
        seeds,
        'remove',
        {
          tolerance: SMART_CUTOUT_TOLERANCE,
          radius: brushRadius,
        },
      );
    applyImageDataUpdate(next, {
      fitToSubjectAfter: false,
      nextMode: editMode,
    });
    resetBrushState();
  }, [applyImageDataUpdate, brushStroke, editMode, image, isBrushing, offset.x, offset.y, pushEditHistory, readImageData, resetBrushState, scale]);

  const handleHistoryAction = useCallback((actionId: HistoryActionId) => {
    if (actionId !== 'undo') {
      return;
    }

    const previous = editHistoryRef.current.pop();
    if (!previous) {
      setCanUndoEdit(false);
      return;
    }

    setCanUndoEdit(editHistoryRef.current.length > 0);
    applyImageDataUpdate(previous, {
      fitToSubjectAfter: false,
      nextMode: 'move',
    });
  }, [applyImageDataUpdate]);

  const handleConfirmCrop = useCallback(() => {
    if (!cropBox) {
      return;
    }

    const imageData = readImageData();
    if (!imageData) {
      return;
    }

    const cropped = cropImageData(imageData, cropBox);
    applyImageDataUpdate(cropped, {
      fitToSubjectAfter: true,
      nextMode: 'move',
      updateSourceImageData: true,
      resetHistory: true,
    });
  }, [applyImageDataUpdate, cropBox, readImageData]);

  const handleCancelCrop = useCallback(() => {
    if (!image) {
      return;
    }

    setCropBox(getInitialFreeCropBox(image.width, image.height, subjectBounds));
    setEditMode('move');
  }, [image, subjectBounds]);

  const processGrid = useCallback((options?: {
    targetColorsOverride?: number;
    targetColorModeOverride?: 'auto' | 'manual';
    closeModalAfter?: boolean;
  }) => {
    if (!image || !palette) {
      return;
    }

    const canvas = processingCanvasRef.current;
    const contourCanvas = contourCanvasRef.current;
    if (!canvas || !contourCanvas) {
      return;
    }

    const imageData = renderToCanvas(canvas, targetConfig.width, targetConfig.height);
    const contourImageData = renderToCanvas(contourCanvas, targetConfig.width * 4, targetConfig.height * 4);
    if (!imageData || !contourImageData) {
      return;
    }

    const resolvedMode = options?.targetColorModeOverride ?? targetColorMode;
    const resolvedTargetColors = options?.targetColorsOverride
      ?? (resolvedMode === 'auto' ? recommendedTargetColors : manualTargetColors);
    const grid = processImageToGrid(imageData, targetConfig.width, targetConfig.height, palette, {
      mode: algorithmMode,
      contourImageData,
      targetColors: resolvedTargetColors,
      workingResolution,
      contourThreshold,
    });

    const tracingCanvas = document.createElement('canvas');
    const traceWidth = Math.min(TRACE_OVERLAY_MAX_SIZE, targetConfig.width * TRACE_OVERLAY_SCALE);
    const traceHeight = Math.min(TRACE_OVERLAY_MAX_SIZE, targetConfig.height * TRACE_OVERLAY_SCALE);
    renderToCanvas(tracingCanvas, traceWidth, traceHeight);
    const tracingOverlayImage = tracingCanvas.toDataURL('image/png');

    onGridLoaded(grid, targetConfig.width, targetConfig.height, tracingOverlayImage);
    if (options?.closeModalAfter) {
      onProcessed?.();
    }
  }, [
    algorithmMode,
    contourThreshold,
    image,
    manualTargetColors,
    onGridLoaded,
    onProcessed,
    palette,
    recommendedTargetColors,
    renderToCanvas,
    targetColorMode,
    targetConfig.height,
    targetConfig.width,
    workingResolution,
  ]);

  const handleProcess = useCallback(() => {
    processGrid({ closeModalAfter: true });
  }, [processGrid]);

  const applyAutoTargetColors = useCallback(() => {
    setTargetColorMode('auto');
    setManualTargetColors(recommendedTargetColors);
    processGrid({
      targetColorsOverride: recommendedTargetColors,
      targetColorModeOverride: 'auto',
    });
  }, [processGrid, recommendedTargetColors]);

  const applyManualTargetColors = useCallback((value: number) => {
    const clampedValue = clamp(value, MIN_TARGET_COLORS, MAX_TARGET_COLORS);
    setTargetColorMode('manual');
    setManualTargetColors(clampedValue);
    processGrid({
      targetColorsOverride: clampedValue,
      targetColorModeOverride: 'manual',
    });
  }, [processGrid]);

  const handleClear = useCallback(() => {
    setImage(null);
    setSourceName('');
    setSubjectBounds(null);
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setDragState(null);
    setEditMode('move');
    setCropBox(null);
    resetBrushState();
    setShowAdvanced(false);
    resetEditHistory();
    setTargetColorMode('auto');
    setRecommendedTargetColors(6);
    setManualTargetColors(6);
    setWorkingResolution(defaultWorkingResolution);
    setContourThreshold(50);
    setIsLoadingImage(false);
    sourceImageDataRef.current = null;
  }, [defaultWorkingResolution, resetBrushState, resetEditHistory]);

  const drawPreview = useCallback(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    canvas.width = PREVIEW_SIZE;
    canvas.height = PREVIEW_SIZE;

    ctx.fillStyle = '#f4efe5';
    ctx.fillRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);

    for (let y = 0; y < PREVIEW_SIZE; y += 20) {
      for (let x = 0; x < PREVIEW_SIZE; x += 20) {
        ctx.fillStyle = ((x + y) / 20) % 2 === 0 ? '#fffdf8' : '#efe6d9';
        ctx.fillRect(x, y, 20, 20);
      }
    }

    if (!image) {
      ctx.strokeStyle = '#d5c8b3';
      ctx.setLineDash([6, 6]);
      ctx.strokeRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
      ctx.setLineDash([]);
      return;
    }

    if (editMode === 'crop' && freeCropDisplayRect && cropBox) {
      ctx.save();
      ctx.drawImage(image, freeCropDisplayRect.x, freeCropDisplayRect.y, freeCropDisplayRect.width, freeCropDisplayRect.height);
      ctx.restore();

      const cropPreviewRect = mapImageRectToPreviewRect(cropBox, freeCropDisplayRect, image.width, image.height);

      ctx.fillStyle = 'rgba(15, 23, 42, 0.5)';
      ctx.fillRect(0, 0, PREVIEW_SIZE, cropPreviewRect.y);
      ctx.fillRect(0, cropPreviewRect.y, cropPreviewRect.x, cropPreviewRect.height);
      ctx.fillRect(cropPreviewRect.x + cropPreviewRect.width, cropPreviewRect.y, PREVIEW_SIZE, cropPreviewRect.height);
      ctx.fillRect(0, cropPreviewRect.y + cropPreviewRect.height, PREVIEW_SIZE, PREVIEW_SIZE);

      ctx.save();
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.strokeRect(cropPreviewRect.x, cropPreviewRect.y, cropPreviewRect.width, cropPreviewRect.height);

      ctx.strokeStyle = 'rgba(249, 115, 22, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cropPreviewRect.x + (cropPreviewRect.width / 3), cropPreviewRect.y);
      ctx.lineTo(cropPreviewRect.x + (cropPreviewRect.width / 3), cropPreviewRect.y + cropPreviewRect.height);
      ctx.moveTo(cropPreviewRect.x + ((cropPreviewRect.width * 2) / 3), cropPreviewRect.y);
      ctx.lineTo(cropPreviewRect.x + ((cropPreviewRect.width * 2) / 3), cropPreviewRect.y + cropPreviewRect.height);
      ctx.moveTo(cropPreviewRect.x, cropPreviewRect.y + (cropPreviewRect.height / 3));
      ctx.lineTo(cropPreviewRect.x + cropPreviewRect.width, cropPreviewRect.y + (cropPreviewRect.height / 3));
      ctx.moveTo(cropPreviewRect.x, cropPreviewRect.y + ((cropPreviewRect.height * 2) / 3));
      ctx.lineTo(cropPreviewRect.x + cropPreviewRect.width, cropPreviewRect.y + ((cropPreviewRect.height * 2) / 3));
      ctx.stroke();

      [
        { x: cropPreviewRect.x, y: cropPreviewRect.y },
        { x: cropPreviewRect.x + (cropPreviewRect.width / 2), y: cropPreviewRect.y },
        { x: cropPreviewRect.x + cropPreviewRect.width, y: cropPreviewRect.y },
        { x: cropPreviewRect.x, y: cropPreviewRect.y + (cropPreviewRect.height / 2) },
        { x: cropPreviewRect.x + cropPreviewRect.width, y: cropPreviewRect.y + (cropPreviewRect.height / 2) },
        { x: cropPreviewRect.x, y: cropPreviewRect.y + cropPreviewRect.height },
        { x: cropPreviewRect.x + (cropPreviewRect.width / 2), y: cropPreviewRect.y + cropPreviewRect.height },
        { x: cropPreviewRect.x + cropPreviewRect.width, y: cropPreviewRect.y + cropPreviewRect.height },
      ].forEach((handle) => {
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#f97316';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.rect(handle.x - 4.5, handle.y - 4.5, 9, 9);
        ctx.fill();
        ctx.stroke();
      });
      ctx.restore();
      return;
    }

    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;

    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.drawImage(image, offset.x, offset.y, drawWidth, drawHeight);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
    ctx.clip();
    ctx.drawImage(image, offset.x, offset.y, drawWidth, drawHeight);
    ctx.restore();

    ctx.strokeStyle = '#ea580c';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
    ctx.setLineDash([]);

    if (brushStroke.length > 0) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = BRUSH_PREVIEW_RADIUS * 2;
      ctx.strokeStyle = editMode === 'brush-remove' ? 'rgba(244, 63, 94, 0.55)' : 'rgba(16, 185, 129, 0.55)';
      ctx.beginPath();
      ctx.moveTo(brushStroke[0]?.x ?? 0, brushStroke[0]?.y ?? 0);
      for (let i = 1; i < brushStroke.length; i++) {
        const point = brushStroke[i] as PreviewPoint;
        ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }, [brushStroke, cropBox, cropRect, editMode, freeCropDisplayRect, image, offset.x, offset.y, scale]);

  useEffect(() => {
    drawPreview();
  }, [drawPreview]);

  useEffect(() => {
    if (!onPreviewChange) {
      return;
    }

    if (!image) {
      onPreviewChange(null);
      return;
    }

    const previewCanvas = document.createElement('canvas');
    const previewWidth = 320;
    const aspectRatio = targetConfig.width / Math.max(1, targetConfig.height);
    const previewHeight = Math.max(160, Math.round(previewWidth / Math.max(0.2, aspectRatio)));
    const previewImageData = renderToCanvas(previewCanvas, previewWidth, previewHeight);

    if (!previewImageData) {
      onPreviewChange(null);
      return;
    }

    onPreviewChange(previewCanvas.toDataURL('image/png'));
  }, [image, onPreviewChange, renderToCanvas, targetConfig.height, targetConfig.width]);

  useEffect(() => {
    onStatusChange?.({
      sourceName: sourceName || null,
      algorithmMode,
      hasReference: Boolean(image),
      workingResolution,
    });
  }, [algorithmMode, image, onStatusChange, sourceName, workingResolution]);

  useEffect(() => {
    onColorControlsChange?.({
      hasImage: Boolean(image),
      targetColorMode,
      recommendedTargetColors,
      selectedTargetColors: targetColorMode === 'auto' ? recommendedTargetColors : manualTargetColors,
      minTargetColors: MIN_TARGET_COLORS,
      maxTargetColors: MAX_TARGET_COLORS,
      applyAutoTargetColors,
      applyManualTargetColors,
    });
  }, [
    applyAutoTargetColors,
    applyManualTargetColors,
    image,
    manualTargetColors,
    onColorControlsChange,
    recommendedTargetColors,
    targetColorMode,
  ]);

  useEffect(() => {
    if (!image) {
      return;
    }

    const processingCanvas = processingCanvasRef.current;
    if (!processingCanvas) {
      return;
    }

    const imageData = renderToCanvas(processingCanvas, targetConfig.width, targetConfig.height);
    if (!imageData) {
      return;
    }

    const recommendation = estimateRecommendedColorLimit(imageData, targetConfig.width, targetConfig.height);
    setRecommendedTargetColors(recommendation);
    if (targetColorMode === 'auto') {
      setManualTargetColors(recommendation);
    }
  }, [image, renderToCanvas, targetColorMode, targetConfig.height, targetConfig.width]);

  const loadImageFile = useCallback((file: File) => {
    if (!isImportImageSizeValid(file)) {
      window.alert(getImportImageSizeError(file));
      return;
    }

    setIsLoadingImage(true);
    const reader = new FileReader();
    reader.onerror = () => {
      setIsLoadingImage(false);
    };
    reader.onload = (event) => {
      const raw = new Image();
      raw.onerror = () => {
        setIsLoadingImage(false);
      };
      raw.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = raw.width;
        canvas.height = raw.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setIsLoadingImage(false);
          return;
        }

        ctx.drawImage(raw, 0, 0);
        const cleaned = removeConnectedWhiteBackground(ctx.getImageData(0, 0, raw.width, raw.height));
        const bounds = findOpaqueBounds(cleaned);
        ctx.putImageData(cleaned, 0, 0);

        const previewUrl = canvas.toDataURL('image/png');
        const cleanedImage = new Image();
        cleanedImage.onerror = () => {
          setIsLoadingImage(false);
        };
        cleanedImage.onload = () => {
          const expandedBounds = bounds ? expandBounds(bounds, 12, raw.width, raw.height) : bounds;
          const fitted = getFittedTransform(expandedBounds, cropRect, cleanedImage.width, cleanedImage.height);

          setSourceName(file.name);
          setSubjectBounds(expandedBounds);
          setImage(cleanedImage);
          setCropBox(getInitialFreeCropBox(cleanedImage.width, cleanedImage.height, expandedBounds));
          sourceImageDataRef.current = cloneImageData(cleaned);
          setScale(clampImportScale(fitted.scale));
          setOffset(fitted.offset);
          setEditMode('crop');
          setTargetColorMode('auto');
          setManualTargetColors(6);
          setRecommendedTargetColors(6);
          resetEditHistory();
          setIsLoadingImage(false);
        };
        cleanedImage.src = previewUrl;
      };
      raw.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, [cropRect, resetEditHistory]);

  useEffect(() => {
    if (!initialImageFile || initialImageFile === lastInitialFileRef.current) {
      return;
    }

    lastInitialFileRef.current = initialImageFile;
    const timer = window.setTimeout(() => {
      loadImageFile(initialImageFile);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [initialImageFile, loadImageFile]);

  useEffect(() => {
    if (!initialPreviewImageUrl) {
      return;
    }

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return;
      }

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const bounds = findOpaqueBounds(imageData);
      const expandedBounds = bounds ? expandBounds(bounds, 12, img.width, img.height) : bounds;
      const fitted = getFittedTransform(expandedBounds, cropRect, img.width, img.height);

      setSourceName('参考图');
      setSubjectBounds(expandedBounds);
      setImage(img);
      setCropBox(getInitialFreeCropBox(img.width, img.height, expandedBounds));
      sourceImageDataRef.current = cloneImageData(imageData);
      setScale(clampImportScale(fitted.scale));
      setOffset(fitted.offset);
      setEditMode('crop');
      setTargetColorMode('auto');
      setManualTargetColors(6);
      setRecommendedTargetColors(6);
      resetEditHistory();
    };
    img.onerror = () => {
    };
    img.src = initialPreviewImageUrl;
  }, [initialPreviewImageUrl, cropRect, resetEditHistory]);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    loadImageFile(file);
    event.target.value = '';
  };

  const requestFilePicker = () => {
    if (onRequestImageFile) {
      onRequestImageFile();
      return;
    }

    fileInputRef.current?.click();
  };

  const isActiveTool = useCallback((id: ToolButtonId) => {
    if (id === 'crop') return editMode === 'crop';
    if (id === 'brush-restore') return editMode === 'brush-restore';
    if (id === 'brush-remove') return editMode === 'brush-remove';
    return false;
  }, [editMode]);

  const handleCanvasMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!image) {
      return;
    }

    const point = getPreviewPoint(event);

    if (editMode === 'crop') {
      if (!freeCropDisplayRect || !cropBox) {
        return;
      }
      const cropPreviewRect = mapImageRectToPreviewRect(cropBox, freeCropDisplayRect, image.width, image.height);
      const handle = getCropHandleAtPoint(point, cropPreviewRect);
      if (!handle) {
        return;
      }

      setDragState({
        kind: 'crop',
        handle,
        startPoint: point,
        startBox: cropBox,
      });
      return;
    }

    if (editMode === 'move') {
      setDragState({
        kind: 'move',
        startPoint: point,
        startOffset: offset,
      });
      return;
    }

    setIsBrushing(true);
    setBrushStroke([point]);
  };

  const handleCanvasMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!image) {
      return;
    }

    const point = getPreviewPoint(event);

    if (dragState?.kind === 'move') {
      setOffset({
        x: dragState.startOffset.x + (point.x - dragState.startPoint.x),
        y: dragState.startOffset.y + (point.y - dragState.startPoint.y),
      });
      return;
    }

    if (dragState?.kind === 'crop') {
      if (!freeCropDisplayRect) {
        return;
      }

      const startImagePoint = mapPreviewPointToImage(dragState.startPoint, freeCropDisplayRect, image.width, image.height);
      const nextImagePoint = mapPreviewPointToImage(point, freeCropDisplayRect, image.width, image.height);
      if (!startImagePoint || !nextImagePoint) {
        return;
      }

      setCropBox(
        resizeCropBox(
          dragState.startBox,
          dragState.handle,
          nextImagePoint.x - startImagePoint.x,
          nextImagePoint.y - startImagePoint.y,
          image.width,
          image.height,
        ),
      );
      return;
    }

    if (!isBrushing) {
      return;
    }

    setBrushStroke((current) => {
      const last = current[current.length - 1];
      if (last && Math.hypot(point.x - last.x, point.y - last.y) < 2.4) {
        return current;
      }
      return [...current, point];
    });
  };

  const handleCanvasMouseUp = () => {
    setDragState(null);
    if (editMode === 'brush-restore' || editMode === 'brush-remove') {
      commitBrushStroke();
    }
  };

  const handleCanvasPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // Touch/pen should work; for mouse, only left button starts edits.
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    if (!image) {
      return;
    }

    // Track active pointers for pinch on touch.
    activePointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    if (editMode === 'move' && activePointersRef.current.size === 2) {
      // Start pinch zoom; cancel any drag/brush state.
      resetBrushState();
      setDragState(null);
      const points = Array.from(activePointersRef.current.values());
      const baseDistance = Math.max(1, Math.hypot(points[0]!.clientX - points[1]!.clientX, points[0]!.clientY - points[1]!.clientY));
      pinchRef.current = { baseDistance, baseScale: scale };
      return;
    }

    if (activePointerIdRef.current !== null) {
      return;
    }
    activePointerIdRef.current = event.pointerId;
    (event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId);

    // Reuse the existing mouse logic (now pointer-compatible) so behavior stays identical.
    handleCanvasMouseDown(event as unknown as React.MouseEvent<HTMLCanvasElement>);
  };

  const handleCanvasPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!image) {
      return;
    }

    if (activePointersRef.current.has(event.pointerId)) {
      activePointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    }

    if (editMode === 'move' && pinchRef.current && activePointersRef.current.size >= 2) {
      event.preventDefault();
      const points = Array.from(activePointersRef.current.values());
      const currentDistance = Math.max(1, Math.hypot(points[0]!.clientX - points[1]!.clientX, points[0]!.clientY - points[1]!.clientY));
      const nextScale = clampImportScale(pinchRef.current.baseScale * (currentDistance / pinchRef.current.baseDistance));
      setScale(nextScale);
      return;
    }

    if (activePointerIdRef.current !== event.pointerId) {
      return;
    }

    handleCanvasMouseMove(event as unknown as React.MouseEvent<HTMLCanvasElement>);
  };

  const handleCanvasPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    activePointersRef.current.delete(event.pointerId);
    if (activePointersRef.current.size < 2) {
      pinchRef.current = null;
    }

    if (activePointerIdRef.current !== event.pointerId) {
      return;
    }
    try {
      (event.currentTarget as HTMLCanvasElement).releasePointerCapture(event.pointerId);
    } catch {
      // Ignore release errors on browsers that auto-release capture.
    }
    activePointerIdRef.current = null;
    handleCanvasMouseUp();
  };

  const handleCanvasPointerCancel = (event: React.PointerEvent<HTMLCanvasElement>) => {
    activePointersRef.current.delete(event.pointerId);
    pinchRef.current = null;
    if (activePointerIdRef.current === event.pointerId) {
      activePointerIdRef.current = null;
      handleCanvasMouseUp();
    }
  };

  const modeHint = editMode === 'crop'
    ? '拖拽四边或四角做自由裁切，确认后进入 50x50 画布编辑'
    : editMode === 'move'
      ? '拖动画布位置，滚轮或滑块细调缩放'
      : editMode === 'brush-restore'
        ? '在被删掉的区域刷一笔，系统按源图颜色与连通区域把内容补回来'
        : '在背景上刷一笔，系统按相近颜色与连通区域扩张删除';

  return (
    <div className={isModal ? 'h-full' : 'rounded-[28px] border border-[#eadfd0] bg-white p-4 shadow-[0_20px_60px_rgba(146,95,37,0.08)]'}>
      {!palette ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-center text-xs text-gray-400">
          请先载入豆子色卡
        </div>
      ) : (
        <div className={isModal ? 'space-y-3' : 'space-y-4'}>
          {isLoadingImage && !image ? (
            <div className={`w-full rounded-[24px] border border-[#e8d9c3] bg-[#fbf6ee] ${isModal ? 'p-7' : 'p-6'}`}>
              <div className="mx-auto max-w-sm">
                <div className="mb-4 flex items-center justify-center gap-3">
                  <svg className="h-7 w-7 animate-spin text-orange-500" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" className="opacity-20" stroke="currentColor" strokeWidth="3" />
                    <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  <p className="text-sm font-black text-[#8d5a24]">正在载入图片...</p>
                </div>
                <div className="space-y-3">
                  <div className="h-5 w-2/3 animate-pulse rounded-lg bg-[#f1e5d3]" />
                  <div className="h-32 w-full animate-pulse rounded-2xl bg-[linear-gradient(90deg,#f3e9da_0%,#fbf7f1_45%,#f3e9da_100%)]" />
                  <div className="h-4 w-1/2 animate-pulse rounded-lg bg-[#f1e5d3]" />
                </div>
              </div>
            </div>
          ) : !image ? (
            <button
              onClick={requestFilePicker}
              className={`flex w-full flex-col items-center gap-2 rounded-[24px] border-2 border-dashed border-[#dcc9ae] bg-[#faf6ef] text-sm font-black text-[#8d5a24] transition hover:border-orange-400 hover:bg-orange-50 ${isModal ? 'py-12' : 'py-8'}`}
            >
              {getMiniIcon('image', 'h-8 w-8 opacity-70')}
              导入参考图片
              <span className="text-xs font-medium text-gray-500">支持自由裁切、自动去白底、智能抠图与 50x50 画布编辑</span>
            </button>
          ) : (
            <div className={isModal ? 'grid gap-3 xl:grid-cols-[360px_minmax(0,1fr)] xl:items-start' : 'space-y-4'}>
                <div className={isModal ? 'space-y-3' : 'space-y-4'}>
                  <div className={`rounded-[24px] border border-gray-100 bg-[#faf8f3] ${isModal ? 'p-2.5' : 'p-3'}`}>
                    <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
                      <span className="truncate font-semibold">{sourceName}</span>
                      <span>{editMode === 'crop' ? '自由裁切' : `${targetConfig.width} × ${targetConfig.height} 画布`}</span>
                    </div>

                    <canvas
                      ref={previewCanvasRef}
                      width={PREVIEW_SIZE}
                      height={PREVIEW_SIZE}
                      onPointerDown={handleCanvasPointerDown}
                      onPointerMove={handleCanvasPointerMove}
                      onPointerUp={handleCanvasPointerUp}
                      onPointerCancel={handleCanvasPointerCancel}
                      onMouseLeave={() => {
                        setDragState(null);
                        if (editMode === 'brush-restore' || editMode === 'brush-remove') {
                          commitBrushStroke();
                        }
                      }}
                      onWheel={(event) => {
                        if (editMode === 'crop') {
                          return;
                        }
                        event.preventDefault();
                        const nextScale = clampImportScale(scale * (event.deltaY > 0 ? 0.985 : 1.015));
                        setScale(nextScale);
                      }}
                      className={`mx-auto rounded-[20px] border border-[#dbc8b0] bg-white shadow-sm ${
                        editMode === 'move' ? 'cursor-move' : editMode === 'crop' ? 'cursor-crosshair' : 'cursor-cell'
                      }`}
                      style={{ touchAction: 'none' }}
                    />

                    <p className="mt-2 text-center text-[11px] leading-5 text-gray-500">{modeHint}</p>

                    {editMode === 'crop' ? (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={handleConfirmCrop}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-orange-200 bg-orange-50 px-3 py-2.5 text-[12px] font-bold text-orange-700 transition hover:bg-orange-100"
                        >
                          {getMiniIcon('check')}
                          OK，应用自由裁切
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelCrop}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-[12px] font-bold text-gray-700 transition hover:bg-gray-50"
                        >
                          {getMiniIcon('close')}
                          取消裁切
                        </button>
                      </div>
                    ) : (
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => fitToSubject()}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-orange-200 bg-orange-50 px-3 py-2.5 text-[12px] font-bold text-orange-700 transition hover:bg-orange-100"
                        >
                          {getToolIcon('auto-cutout', 'h-4 w-4')}
                          主体适配到阅览窗口
                        </button>
                      </div>
                    )}
                  </div>

                  {editMode !== 'crop' && (
                    <div className={`rounded-2xl border border-gray-100 bg-gray-50 ${isModal ? 'p-2.5' : 'p-3'}`}>
                      <div className="mb-2 flex items-center justify-between text-xs font-bold text-gray-500">
                        <span>画布缩放</span>
                        <span className="text-orange-600">{Math.round(scale * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={zoomSliderValue}
                        onChange={(event) => setScale(sliderValueToZoomScale(Number.parseFloat(event.target.value)))}
                        className="w-full accent-orange-500"
                      />
                      <p className="mt-1 text-[10px] text-gray-500">范围 {Math.round(IMPORT_ZOOM_MIN_SCALE * 100)}% - {Math.round(IMPORT_ZOOM_MAX_SCALE * 100)}%</p>
                    </div>
                  )}
                </div>

                <div className={isModal ? 'space-y-3' : 'space-y-4'}>
                  <div className="rounded-[24px] border border-[#ebe0cf] bg-white p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div>
                        <div className="text-xs font-black text-gray-800">画布工具</div>
                        <p className="mt-1 text-[11px] leading-5 text-gray-500">移动是默认状态；这里只保留需要显式切换的操作工具。</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {IMAGE_PROCESSOR_HISTORY_ACTIONS.map((action) => (
                          <button
                            key={action.id}
                            type="button"
                            onClick={() => handleHistoryAction(action.id)}
                            disabled={!canUndoEdit}
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black transition ${
                              canUndoEdit
                                ? 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                : 'cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-300'
                            }`}
                          >
                            {getMiniIcon('undo', 'h-3.5 w-3.5')}
                            {action.label}
                          </button>
                        ))}
                        <span className="rounded-full bg-[#fff3e6] px-2 py-1 text-[10px] font-black text-[#c45a12]">
                          {editMode === 'crop' ? '自由裁切中' : '50x50 画布编辑'}
                        </span>
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {IMAGE_PROCESSOR_TOOL_BUTTONS.map((button) => (
                        <button
                          key={button.id}
                          type="button"
                          onClick={() => handleToolSelection(button.id)}
                          className={`inline-flex items-center justify-center gap-2 rounded-2xl border px-3 py-2.5 text-[12px] font-bold transition ${getToneClasses(button.tone, isActiveTool(button.id))}`}
                        >
                          {getToolIcon(button.id)}
                          {button.label}
                        </button>
                      ))}
                    </div>

                    <div className="mt-3 rounded-2xl border border-dashed border-[#eadcca] bg-[#fcf8f1] px-3 py-2 text-[11px] leading-5 text-gray-600">
                      {editMode === 'crop'
                        ? '进入自由裁切后，直接在左侧预览窗口下方确认即可；确认后默认回到移动画布。'
                        : '先用“自动识别”快速抠出主体，再用删除/恢复笔刷修正边缘；点“撤销”可以回到上一步抠图状态。'}
                    </div>
                  </div>

                  <div className="grid gap-2.5">
                    <div className={`rounded-2xl border border-gray-100 bg-gray-50 ${isModal ? 'p-2.5' : 'p-3'}`}>
                      <div className="mb-2 text-xs font-bold text-gray-500">算法模式</div>
                      <select
                        value={algorithmMode}
                        onChange={(event) => setAlgorithmMode(event.target.value as AlgorithmMode)}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 outline-none focus:border-orange-300"
                      >
                        {enableExperimentalModes && <option value="ink-outline-fill">黑线稿填色（实验）</option>}
                        {enableExperimentalModes && <option value="contour-locked">轮廓锁定（多尺度）</option>}
                        {enableExperimentalModes && <option value="legacy-guided">细节引导</option>}
                        <option value="legacy-clean">主体清理优先</option>
                        <option value="legacy-nearest">最近色直出</option>
                      </select>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-gray-100 bg-[#faf8f3] p-3">
                    <button
                      type="button"
                      onClick={() => setShowAdvanced((current) => !current)}
                      className="inline-flex w-full items-center justify-between gap-2 rounded-xl border border-[#eadfce] bg-white px-3 py-2 text-left text-xs font-bold text-gray-700 transition hover:bg-gray-50"
                    >
                      <span className="inline-flex items-center gap-2">
                        {getMiniIcon('grid', 'h-3.5 w-3.5')}
                        高级设置
                      </span>
                      <svg className={`h-3.5 w-3.5 transition ${showAdvanced ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>

                    {showAdvanced && (
                      <div className="mt-3 space-y-3">
                        {enableExperimentalModes && (
                          <div className="rounded-2xl border border-gray-100 bg-white p-3">
                            <div className="mb-2 flex items-center justify-between text-xs font-bold text-gray-500">
                              <span>工作分辨率</span>
                              <span className="text-orange-600">{workingResolution} × {workingResolution}</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              {WORKING_RESOLUTION_OPTIONS.map((option) => (
                                <button
                                  key={option}
                                  type="button"
                                  onClick={() => setWorkingResolution(option)}
                                  className={`inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition ${
                                    workingResolution === option
                                      ? 'bg-orange-500 text-white'
                                      : 'border border-gray-200 bg-white text-gray-600'
                                  }`}
                                >
                                  {getMiniIcon('grid', 'h-3.5 w-3.5')}
                                  {option}
                                </button>
                              ))}
                            </div>
                            <p className="mt-2 text-[11px] leading-5 text-gray-500">
                              多尺度模式先在这一级做区域合并，再投影到 {targetConfig.width} × {targetConfig.height}。
                            </p>
                          </div>
                        )}

                        {algorithmMode === 'ink-outline-fill' && (
                          <div className="rounded-2xl border border-gray-100 bg-white p-3">
                            <div className="mb-2 flex items-center justify-between text-xs font-bold text-gray-500">
                              <span>轮廓阈值</span>
                              <span className="text-orange-600">{contourThreshold}</span>
                            </div>
                            <input
                              type="range"
                              min={INK_THRESHOLD_MIN}
                              max={INK_THRESHOLD_MAX}
                              step="1"
                              value={contourThreshold}
                              onChange={(event) => setContourThreshold(Number.parseInt(event.target.value, 10))}
                              className="w-full accent-orange-500"
                            />
                            <p className="mt-2 text-[11px] leading-5 text-gray-500">
                              数值越高，越容易把深色线条识别为轮廓；数值越低，轮廓更严格。
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => {
                        handleClear();
                        requestFilePicker();
                      }}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-bold text-gray-700 transition hover:bg-gray-50"
                    >
                      {getMiniIcon('refresh')}
                      {IMAGE_PROCESSOR_FOOTER_ACTIONS[0]?.label}
                    </button>
                    <button
                      type="button"
                      onClick={handleProcess}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-orange-500 px-3 py-2.5 text-xs font-black text-white shadow-sm transition hover:bg-orange-600"
                    >
                      {getMiniIcon('play')}
                      {IMAGE_PROCESSOR_FOOTER_ACTIONS[1]?.label}
                    </button>
                  </div>
                </div>
              </div>
          )}

          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
        </div>
      )}

      <canvas ref={processingCanvasRef} className="hidden" />
      <canvas ref={contourCanvasRef} className="hidden" />
    </div>
  );
};
