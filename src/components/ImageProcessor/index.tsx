import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AlgorithmMode, Color, GridConfig, GridCell } from '../../types';
import { estimateRecommendedColorLimit, processImageToGrid } from '../../algorithms/kMeans';
import {
  applyPolygonCutout,
  computeCropSourceRect,
  expandBounds,
  findOpaqueBounds,
  IMPORT_ZOOM_MAX_SCALE,
  IMPORT_ZOOM_MIN_SCALE,
  removeConnectedWhiteBackground,
  removeEdgeConnectedBackgroundByColor,
  sliderValueToZoomScale,
  zoomScaleToSliderValue,
} from '../../utils/imageProcessing';
import { getImportImageSizeError, isImportImageSizeValid } from '../../utils/importImage';

interface ImageProcessorProps {
  palette: Color[] | null;
  targetConfig: GridConfig;
  onGridLoaded: (cells: GridCell[][], width: number, height: number, overlayImage: string | null) => void;
  variant?: 'panel' | 'modal';
  initialImageFile?: File | null;
  onRequestImageFile?: () => void;
  enableExperimentalModes?: boolean;
  defaultAlgorithmMode?: AlgorithmMode;
  defaultWorkingResolution?: number;
  onProcessed?: () => void;
  onPreviewChange?: (previewImage: string | null) => void;
  onStatusChange?: (status: {
    sourceName: string | null;
    algorithmMode: AlgorithmMode;
    hasReference: boolean;
    workingResolution: number;
  }) => void;
}

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PreviewPoint {
  x: number;
  y: number;
}

type EditMode = 'move' | 'lasso-keep' | 'lasso-remove';

const PREVIEW_SIZE = 280;
const PREVIEW_PADDING = 20;
const MIN_TARGET_COLORS = 4;
const MAX_TARGET_COLORS = 12;
const WORKING_RESOLUTION_OPTIONS = [120, 160, 200];
const TRACE_OVERLAY_SCALE = 12;
const TRACE_OVERLAY_MAX_SIZE = 1200;

const clampImportScale = (value: number) => Math.min(
  IMPORT_ZOOM_MAX_SCALE,
  Math.max(IMPORT_ZOOM_MIN_SCALE, Number(value.toFixed(4))),
);

const getCropRect = (width: number, height: number): CropRect => {
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

const getFittedTransform = (
  bounds: ReturnType<typeof findOpaqueBounds>,
  cropRect: CropRect,
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

export const ImageProcessor: React.FC<ImageProcessorProps> = ({
  palette,
  targetConfig,
  onGridLoaded,
  variant = 'panel',
  initialImageFile = null,
  onRequestImageFile,
  enableExperimentalModes = false,
  defaultAlgorithmMode = 'legacy-clean',
  defaultWorkingResolution = 120,
  onProcessed,
  onPreviewChange,
  onStatusChange,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const processingCanvasRef = useRef<HTMLCanvasElement>(null);
  const contourCanvasRef = useRef<HTMLCanvasElement>(null);
  const lastInitialFileRef = useRef<File | null>(null);

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [isLoadingImage, setIsLoadingImage] = useState(false);
  const [sourceName, setSourceName] = useState('');
  const [subjectBounds, setSubjectBounds] = useState<ReturnType<typeof findOpaqueBounds>>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [editMode, setEditMode] = useState<EditMode>('move');
  const [isLassoDrawing, setIsLassoDrawing] = useState(false);
  const [lassoPath, setLassoPath] = useState<PreviewPoint[]>([]);
  const [algorithmMode, setAlgorithmMode] = useState<AlgorithmMode>(defaultAlgorithmMode);
  const [targetColorMode, setTargetColorMode] = useState<'auto' | 'manual'>('auto');
  const [recommendedTargetColors, setRecommendedTargetColors] = useState(6);
  const [manualTargetColors, setManualTargetColors] = useState(6);
  const [workingResolution, setWorkingResolution] = useState(defaultWorkingResolution);
  const cropRect = useMemo(
    () => getCropRect(targetConfig.width, targetConfig.height),
    [targetConfig.height, targetConfig.width],
  );
  const isModal = variant === 'modal';
  const zoomSliderValue = useMemo(() => zoomScaleToSliderValue(scale), [scale]);

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

  const applyImageDataUpdate = useCallback((nextImageData: ImageData, fitToSubjectAfter = false) => {
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
      const expandedBounds = bounds ? expandBounds(bounds, 12, nextImage.width, nextImage.height) : bounds;
      setImage(nextImage);
      setSubjectBounds(expandedBounds);

      if (fitToSubjectAfter) {
        const fitted = getFittedTransform(expandedBounds, cropRect, nextImage.width, nextImage.height);
        setScale(clampImportScale(fitted.scale));
        setOffset(fitted.offset);
      } else {
        setScale((prev) => clampImportScale(prev));
      }
    };
    nextImage.src = previewUrl;
  }, [cropRect]);

  const getPreviewPoint = useCallback((event: React.MouseEvent<HTMLCanvasElement>): PreviewPoint => {
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

  const completeLassoSelection = useCallback(() => {
    if (!isLassoDrawing || editMode === 'move' || lassoPath.length < 3) {
      setIsLassoDrawing(false);
      setLassoPath([]);
      return;
    }

    const imageData = readImageData();
    if (!imageData) {
      setIsLassoDrawing(false);
      setLassoPath([]);
      return;
    }

    const polygon = lassoPath.map((point) => ({
      x: (point.x - offset.x) / Math.max(0.01, scale),
      y: (point.y - offset.y) / Math.max(0.01, scale),
    }));
    const next = applyPolygonCutout(
      imageData,
      polygon,
      editMode === 'lasso-keep' ? 'keep' : 'remove',
    );
    applyImageDataUpdate(next, false);
    setIsLassoDrawing(false);
    setLassoPath([]);
  }, [applyImageDataUpdate, editMode, isLassoDrawing, lassoPath, offset.x, offset.y, readImageData, scale]);

  const handleAutoCutout = useCallback(() => {
    const imageData = readImageData();
    if (!imageData) {
      return;
    }

    const cleaned = removeEdgeConnectedBackgroundByColor(imageData, 46);
    applyImageDataUpdate(cleaned, false);
  }, [applyImageDataUpdate, readImageData]);

  const handleApplyCrop = useCallback(() => {
    if (!image) {
      return;
    }

    const sourceRect = computeCropSourceRect(
      cropRect,
      offset,
      scale,
      image.width,
      image.height,
    );
    if (!sourceRect) {
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = sourceRect.sw;
    canvas.height = sourceRect.sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      image,
      sourceRect.sx,
      sourceRect.sy,
      sourceRect.sw,
      sourceRect.sh,
      0,
      0,
      sourceRect.sw,
      sourceRect.sh,
    );

    const imageData = ctx.getImageData(0, 0, sourceRect.sw, sourceRect.sh);
    applyImageDataUpdate(imageData, true);
  }, [applyImageDataUpdate, cropRect, image, offset, scale]);

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

    ctx.fillStyle = '#f3eee5';
    ctx.fillRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);

    for (let y = 0; y < PREVIEW_SIZE; y += 20) {
      for (let x = 0; x < PREVIEW_SIZE; x += 20) {
        ctx.fillStyle = ((x + y) / 20) % 2 === 0 ? '#ffffff' : '#efe5d8';
        ctx.fillRect(x, y, 20, 20);
      }
    }

    ctx.fillStyle = 'rgba(51, 65, 85, 0.08)';
    ctx.fillRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);

    if (!image) {
      ctx.strokeStyle = '#d5c8b3';
      ctx.setLineDash([6, 6]);
      ctx.strokeRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
      ctx.setLineDash([]);
      return;
    }

    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;

    ctx.save();
    ctx.globalAlpha = 0.22;
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

    if (lassoPath.length > 1) {
      ctx.save();
      ctx.strokeStyle = editMode === 'lasso-remove' ? '#dc2626' : '#16a34a';
      ctx.fillStyle = editMode === 'lasso-remove' ? 'rgba(220, 38, 38, 0.16)' : 'rgba(22, 163, 74, 0.14)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(lassoPath[0]?.x ?? 0, lassoPath[0]?.y ?? 0);
      for (let i = 1; i < lassoPath.length; i++) {
        const point = lassoPath[i] as PreviewPoint;
        ctx.lineTo(point.x, point.y);
      }
      if (!isLassoDrawing) {
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }, [cropRect, editMode, image, isLassoDrawing, lassoPath, offset.x, offset.y, scale]);

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
    drawPreview();
  }, [drawPreview]);

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

  useEffect(() => {
    if (image) {
      const frame = requestAnimationFrame(() => fitToSubject());
      return () => cancelAnimationFrame(frame);
    }
  }, [cropRect, fitToSubject, image]);

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
          setScale(clampImportScale(fitted.scale));
          setOffset(fitted.offset);
          setTargetColorMode('auto');
          setManualTargetColors(6);
          setRecommendedTargetColors(6);
          setIsLoadingImage(false);
        };
        cleanedImage.src = previewUrl;
      };
      raw.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, [cropRect]);

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

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    loadImageFile(file);
    e.target.value = '';
  };

  const requestFilePicker = () => {
    if (onRequestImageFile) {
      onRequestImageFile();
      return;
    }

    fileInputRef.current?.click();
  };

  const handleProcess = () => {
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

    const resolvedTargetColors = targetColorMode === 'auto' ? recommendedTargetColors : manualTargetColors;
    const grid = processImageToGrid(imageData, targetConfig.width, targetConfig.height, palette, {
      mode: algorithmMode,
      contourImageData,
      targetColors: resolvedTargetColors,
      workingResolution,
    });

    const tracingCanvas = document.createElement('canvas');
    const traceWidth = Math.min(TRACE_OVERLAY_MAX_SIZE, targetConfig.width * TRACE_OVERLAY_SCALE);
    const traceHeight = Math.min(TRACE_OVERLAY_MAX_SIZE, targetConfig.height * TRACE_OVERLAY_SCALE);
    renderToCanvas(tracingCanvas, traceWidth, traceHeight);
    const tracingOverlayImage = tracingCanvas.toDataURL('image/png');

    onGridLoaded(grid, targetConfig.width, targetConfig.height, tracingOverlayImage);
    onProcessed?.();
  };

  const handleClear = () => {
    setImage(null);
    setSourceName('');
    setSubjectBounds(null);
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setEditMode('move');
    setIsDragging(false);
    setIsLassoDrawing(false);
    setLassoPath([]);
    setTargetColorMode('auto');
    setRecommendedTargetColors(6);
    setManualTargetColors(6);
    setWorkingResolution(defaultWorkingResolution);
    setIsLoadingImage(false);
  };

  return (
    <div className={isModal ? 'h-full' : 'rounded-[28px] border border-[#eadfd0] bg-white p-4 shadow-[0_20px_60px_rgba(146,95,37,0.08)]'}>
      <div className={`${isModal ? 'mb-3' : 'mb-4'} flex items-center justify-between`}>
        <div>
          <h3 className={`${isModal ? 'text-base' : 'text-sm'} font-black text-gray-800`}>图片导入</h3>
          <p className="text-xs text-gray-500">支持自动抠图、划线抠图与裁切，只对主体做拼豆计算</p>
        </div>
        {image && <span className="rounded-full bg-orange-50 px-2 py-1 text-[10px] font-bold text-orange-600">主体已识别</span>}
      </div>

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
              <svg className="h-8 w-8 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              导入参考图片
              <span className="text-xs font-medium text-gray-500">支持裁切、缩放、自动去白底</span>
            </button>
          ) : (
            <div className={isModal ? 'grid gap-3 xl:grid-cols-[360px_minmax(0,1fr)] xl:items-start' : 'space-y-4'}>
              <div className={isModal ? 'space-y-3' : 'space-y-4'}>
                <div className={`rounded-[24px] border border-gray-100 bg-[#faf8f3] ${isModal ? 'p-2.5' : 'p-3'}`}>
                  <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
                    <span className="truncate font-semibold">{sourceName}</span>
                    <span>{targetConfig.width} × {targetConfig.height}</span>
                  </div>

                  <canvas
                    ref={previewCanvasRef}
                    width={PREVIEW_SIZE}
                    height={PREVIEW_SIZE}
                    onMouseDown={(e) => {
                      const point = getPreviewPoint(e);
                      if (editMode === 'move') {
                        setIsDragging(true);
                        setDragStart({ x: point.x - offset.x, y: point.y - offset.y });
                        return;
                      }

                      setIsLassoDrawing(true);
                      setLassoPath([point]);
                    }}
                    onMouseMove={(e) => {
                      const point = getPreviewPoint(e);
                      if (editMode === 'move') {
                        if (!isDragging) {
                          return;
                        }
                        setOffset({
                          x: point.x - dragStart.x,
                          y: point.y - dragStart.y,
                        });
                        return;
                      }

                      if (!isLassoDrawing) {
                        return;
                      }

                      setLassoPath((prev) => {
                        const last = prev[prev.length - 1];
                        if (last && Math.hypot(point.x - last.x, point.y - last.y) < 1.4) {
                          return prev;
                        }
                        return [...prev, point];
                      });
                    }}
                    onMouseUp={() => {
                      if (editMode === 'move') {
                        setIsDragging(false);
                        return;
                      }
                      completeLassoSelection();
                    }}
                    onMouseLeave={() => {
                      if (editMode === 'move') {
                        setIsDragging(false);
                        return;
                      }
                      completeLassoSelection();
                    }}
                    onWheel={(e) => {
                      e.preventDefault();
                      const nextScale = clampImportScale(scale * (e.deltaY > 0 ? 0.985 : 1.015));
                      setScale(nextScale);
                    }}
                    className={`mx-auto rounded-[20px] border border-[#dbc8b0] bg-white shadow-sm ${
                      editMode === 'move' ? 'cursor-move' : 'cursor-crosshair'
                    }`}
                  />

                  <p className="mt-2 text-center text-[11px] text-gray-500">
                    {editMode === 'move'
                      ? '拖动调整裁切位置，滚轮或滑块细调缩放'
                      : editMode === 'lasso-keep'
                        ? '划线圈出要保留的主体，松开鼠标应用'
                        : '划线圈出要删除的区域，松开鼠标应用'}
                  </p>
                </div>

                <div className={`rounded-2xl border border-gray-100 bg-gray-50 ${isModal ? 'p-2.5' : 'p-3'}`}>
                  <div className="mb-2 flex items-center justify-between text-xs font-bold text-gray-500">
                    <span>缩放</span>
                    <span className="text-orange-600">{Math.round(scale * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={zoomSliderValue}
                    onChange={(e) => setScale(sliderValueToZoomScale(Number.parseFloat(e.target.value)))}
                    className="w-full accent-orange-500"
                  />
                  <p className="mt-1 text-[10px] text-gray-500">范围 {Math.round(IMPORT_ZOOM_MIN_SCALE * 100)}% - {Math.round(IMPORT_ZOOM_MAX_SCALE * 100)}%</p>
                </div>
              </div>

              <div className={isModal ? 'space-y-3' : 'space-y-4'}>
                <div className="grid gap-2.5 md:grid-cols-2">
                  <div className={`rounded-2xl border border-gray-100 bg-gray-50 ${isModal ? 'p-2.5' : 'p-3'}`}>
                    <div className="mb-2 text-xs font-bold text-gray-500">算法模式</div>
                    <select
                      value={algorithmMode}
                      onChange={(e) => setAlgorithmMode(e.target.value as AlgorithmMode)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 outline-none focus:border-orange-300"
                    >
                      {enableExperimentalModes && <option value="contour-locked">轮廓锁定（多尺度）</option>}
                      {enableExperimentalModes && <option value="legacy-guided">细节引导</option>}
                      <option value="legacy-clean">主体清理优先</option>
                      <option value="legacy-nearest">最近色直出</option>
                    </select>
                  </div>

                  <div className={`rounded-2xl border border-gray-100 bg-gray-50 ${isModal ? 'p-2.5' : 'p-3'}`}>
                    <div className="mb-2 flex items-center justify-between text-xs font-bold text-gray-500">
                      <span>目标颜色数</span>
                      <span className="text-orange-600">
                        {targetColorMode === 'auto' ? `自动 ${recommendedTargetColors}` : manualTargetColors}
                      </span>
                    </div>
                    <div className="mb-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setTargetColorMode('auto');
                          setManualTargetColors(recommendedTargetColors);
                        }}
                        className={`rounded-xl px-3 py-2 text-xs font-bold transition ${
                          targetColorMode === 'auto' ? 'bg-orange-500 text-white' : 'border border-gray-200 bg-white text-gray-600'
                        }`}
                      >
                        自动
                      </button>
                      <button
                        type="button"
                        onClick={() => setTargetColorMode('manual')}
                        className={`rounded-xl px-3 py-2 text-xs font-bold transition ${
                          targetColorMode === 'manual' ? 'bg-orange-500 text-white' : 'border border-gray-200 bg-white text-gray-600'
                        }`}
                      >
                        手动
                      </button>
                    </div>
                    <input
                      type="range"
                      min={MIN_TARGET_COLORS}
                      max={MAX_TARGET_COLORS}
                      step="1"
                      value={targetColorMode === 'auto' ? recommendedTargetColors : manualTargetColors}
                      onChange={(e) => {
                        setTargetColorMode('manual');
                        setManualTargetColors(Number.parseInt(e.target.value, 10));
                      }}
                      className="w-full accent-orange-500"
                    />
                  </div>

                  <div className={`rounded-2xl border border-gray-100 bg-gray-50 md:col-span-2 ${isModal ? 'p-2.5' : 'p-3'}`}>
                    <div className="mb-2 text-xs font-bold text-gray-500">抠图工具</div>
                    <div className="grid gap-2 sm:grid-cols-[repeat(3,minmax(0,1fr))]">
                      <button
                        type="button"
                        onClick={() => {
                          setEditMode('move');
                          setIsLassoDrawing(false);
                          setLassoPath([]);
                        }}
                        className={`rounded-xl px-2 py-2 text-[11px] font-bold transition ${
                          editMode === 'move' ? 'bg-orange-500 text-white' : 'border border-gray-200 bg-white text-gray-600'
                        }`}
                      >
                        移动
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditMode('lasso-keep');
                          setIsLassoDrawing(false);
                          setLassoPath([]);
                        }}
                        className={`rounded-xl px-2 py-2 text-[11px] font-bold transition ${
                          editMode === 'lasso-keep' ? 'bg-emerald-500 text-white' : 'border border-gray-200 bg-white text-gray-600'
                        }`}
                      >
                        划线保留
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditMode('lasso-remove');
                          setIsLassoDrawing(false);
                          setLassoPath([]);
                        }}
                        className={`rounded-xl px-2 py-2 text-[11px] font-bold transition ${
                          editMode === 'lasso-remove' ? 'bg-red-500 text-white' : 'border border-gray-200 bg-white text-gray-600'
                        }`}
                      >
                        划线删除
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handleAutoCutout}
                      className="mt-2 w-full rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-bold text-orange-700 transition hover:bg-orange-100"
                    >
                      自动识别主体并抠图
                    </button>
                  </div>
                </div>

                {enableExperimentalModes && (
                  <div className={`rounded-2xl border border-gray-100 bg-gray-50 ${isModal ? 'p-2.5' : 'p-3'}`}>
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
                          className={`rounded-xl px-3 py-2 text-xs font-bold transition ${
                            workingResolution === option
                              ? 'bg-orange-500 text-white'
                              : 'border border-gray-200 bg-white text-gray-600'
                          }`}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-[11px] leading-5 text-gray-500">
                      多尺度模式先在这一级做区域合并，再投影到 {targetConfig.width} × {targetConfig.height}。
                    </p>
                  </div>
                )}

                {isModal && (
                  <div className="rounded-2xl border border-gray-100 bg-[#faf8f3] p-3">
                    <h4 className="mb-1.5 text-xs font-black text-gray-800">导入说明</h4>
                    <div className="space-y-1 text-xs leading-6 text-gray-500">
                      <p>1. 导入后可先用“自动识别主体并抠图”。</p>
                      <p>2. 需要精修时切换“划线保留/划线删除”在左侧直接圈选。</p>
                      <p>3. 确认后点击“应用裁切”，再设置算法与颜色数生成图纸。</p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <button
                    type="button"
                    onClick={fitToSubject}
                    className={`rounded-xl border border-gray-200 bg-white px-3 ${isModal ? 'py-1.5' : 'py-2'} text-xs font-bold text-gray-700 transition hover:bg-gray-50`}
                  >
                    主体适配
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyCrop}
                    className={`rounded-xl border border-orange-200 bg-orange-50 px-3 ${isModal ? 'py-1.5' : 'py-2'} text-xs font-bold text-orange-700 transition hover:bg-orange-100`}
                  >
                    应用裁切
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleClear();
                      requestFilePicker();
                    }}
                    className={`rounded-xl border border-gray-200 bg-white px-3 ${isModal ? 'py-1.5' : 'py-2'} text-xs font-bold text-gray-700 transition hover:bg-gray-50`}
                  >
                    重新导入
                  </button>
                  <button
                    type="button"
                    onClick={handleProcess}
                    className={`rounded-xl bg-orange-500 px-3 ${isModal ? 'py-1.5' : 'py-2'} text-xs font-black text-white shadow-sm transition hover:bg-orange-600`}
                  >
                    生成图纸
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
