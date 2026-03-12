import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Color, DrawMode, GridState } from '../../types';
import { buildColorLabelMap } from '../../utils/pattern';
import {
  clampZoom,
  computeAnchoredScrollOffset,
  getTouchDistance,
  getTouchMidpoint,
  shouldStartViewportPanning,
  stepZoom,
} from '../../utils/gridZoom';
import { getPatternCellTextStyle, getPatternGridLineStyle, getPatternNumberCellStyle } from '../../utils/patternCanvas';

export type EditorViewMode = 'color' | 'number' | 'overlay';

type ToolGroup = 'draw' | 'select' | 'shape';

const TOOL_BUTTONS: Array<{
  mode: DrawMode;
  label: string;
  group: ToolGroup;
  activeClass: string;
  icon: (active: boolean) => React.ReactNode;
}> = [
  {
    mode: 'paint',
    label: '画笔',
    group: 'draw',
    activeClass: 'bg-orange-500 text-white',
    icon: (active) => (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 5l5 5" />
        <path d="M4 20l4-1 10-10-3-3L5 16l-1 4z" />
        <path d="M13 7l3 3" className={active ? 'opacity-100' : 'opacity-70'} />
      </svg>
    ),
  },
  {
    mode: 'fill',
    label: '油漆桶',
    group: 'draw',
    activeClass: 'bg-amber-500 text-white',
    icon: () => (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M7 10l6-6 5 5-6 6z" />
        <path d="M4 20h10" />
        <path d="M15 14c0 1.8 1.3 3 3 3s3-1.2 3-3-1.3-3-3-3" />
      </svg>
    ),
  },
  {
    mode: 'pick',
    label: '取色',
    group: 'draw',
    activeClass: 'bg-teal-600 text-white',
    icon: () => (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10 14l-6 6" />
        <path d="M14.5 3a4.5 4.5 0 013.2 7.7l-5.6 5.6-6.3-6.3 5.6-5.6A4.5 4.5 0 0114.5 3z" />
        <circle cx="8" cy="16" r="1" />
      </svg>
    ),
  },
  {
    mode: 'erase',
    label: '橡皮擦',
    group: 'draw',
    activeClass: 'bg-gray-900 text-white',
    icon: () => (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M7 16l7-7 4 4-4 4H9z" />
        <path d="M3 20h18" />
      </svg>
    ),
  },
  {
    mode: 'select',
    label: '框选',
    group: 'select',
    activeClass: 'bg-indigo-600 text-white',
    icon: () => (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 8V4h4" />
        <path d="M16 4h4v4" />
        <path d="M20 16v4h-4" />
        <path d="M8 20H4v-4" />
        <path d="M8 4h3" />
        <path d="M13 20h3" />
        <path d="M4 13v-2" />
        <path d="M20 13v-2" />
      </svg>
    ),
  },
  {
    mode: 'move',
    label: '移动选区',
    group: 'select',
    activeClass: 'bg-indigo-700 text-white',
    icon: () => (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2v20" />
        <path d="M2 12h20" />
        <path d="M12 2l-3 3" />
        <path d="M12 2l3 3" />
        <path d="M12 22l-3-3" />
        <path d="M12 22l3-3" />
        <path d="M2 12l3-3" />
        <path d="M2 12l3 3" />
        <path d="M22 12l-3-3" />
        <path d="M22 12l-3 3" />
      </svg>
    ),
  },
  {
    mode: 'select-color',
    label: '同色选取',
    group: 'select',
    activeClass: 'bg-violet-700 text-white',
    icon: () => (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="10.5" cy="10.5" r="5.5" />
        <path d="M15 15l5 5" />
        <circle cx="9" cy="9" r="1" />
        <circle cx="12" cy="11.5" r="1" />
        <circle cx="8" cy="12.5" r="0.8" />
      </svg>
    ),
  },
  {
    mode: 'pan',
    label: '视图平移',
    group: 'draw',
    activeClass: 'bg-slate-700 text-white',
    icon: () => (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M8 12V6a1 1 0 0 1 2 0v6" />
        <path d="M12 12V4a1 1 0 0 1 2 0v8" />
        <path d="M16 13V7a1 1 0 0 1 2 0v6" />
        <path d="M6 13v-1a1 1 0 0 1 2 0v1" />
        <path d="M6 13v3a6 6 0 0 0 6 6h1a5 5 0 0 0 5-5v-3a2 2 0 0 0-2-2h-3" />
      </svg>
    ),
  },
  {
    mode: 'line',
    label: '直线',
    group: 'shape',
    activeClass: 'bg-sky-600 text-white',
    icon: () => (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 18L20 6" />
        <circle cx="4" cy="18" r="2" />
        <circle cx="20" cy="6" r="2" />
      </svg>
    ),
  },
  {
    mode: 'rectangle',
    label: '矩形填充',
    group: 'shape',
    activeClass: 'bg-sky-600 text-white',
    icon: () => (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="5" y="7" width="14" height="10" rx="1.5" />
      </svg>
    ),
  },
  {
    mode: 'ellipse',
    label: '圆形填充',
    group: 'shape',
    activeClass: 'bg-sky-600 text-white',
    icon: () => (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <ellipse cx="12" cy="12" rx="7" ry="5" />
      </svg>
    ),
  },
  {
    mode: 'triangle',
    label: '三角形填充',
    group: 'shape',
    activeClass: 'bg-sky-600 text-white',
    icon: () => (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 5l8 14H4z" />
      </svg>
    ),
  },
];

const TOOL_GROUPS: Array<{ id: ToolGroup; label: string }> = [
  { id: 'draw', label: '绘制' },
  { id: 'select', label: '选择' },
  { id: 'shape', label: '形状' },
];

interface GridEditorProps {
  gridState: GridState;
  hoverLayerPreview: Array<{ x: number; y: number; color: Color }>;
  selectionPoints: Array<{ x: number; y: number }>;
  viewMode: EditorViewMode;
  overlayImage: string | null;
  overlayOpacity: number;
  previewPoints: Array<{ x: number; y: number }>;
  previewColor: Color | null;
  drawMode: DrawMode;
  externalViewportPan?: { requestId: number; dx: number; dy: number };
  externalViewportZoom?: { requestId: number; factor: number };
  colorAdjustment?: {
    enabled: boolean;
    targetColorMode: 'auto' | 'manual';
    recommendedTargetColors: number;
    selectedTargetColors: number;
    minTargetColors: number;
    maxTargetColors: number;
    onApplyAuto: () => void;
    onApplyManual: (value: number) => void;
  };
  onDrawModeChange: (mode: DrawMode) => void;
  onCellMouseDown: (x: number, y: number) => void;
  onCellMouseEnter: (x: number, y: number) => void;
  onGlobalMouseUp: () => void;
  onSelectColor: (color: Color) => void;
}

const BASE_CELL_SIZE = 18;
const FREE_PAN_EXTRA = 220;
const FREE_PAN_MIN = 360;
const TRACKPAD_PAN_MULTIPLIER = 2.1;
const TRACKPAD_DELTA_FALLBACK_THRESHOLD = 0.08;
const clampFreePanOffset = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

export const GridEditor: React.FC<GridEditorProps> = ({
  gridState,
  hoverLayerPreview,
  selectionPoints,
  viewMode,
  overlayImage,
  overlayOpacity,
  previewPoints,
  previewColor,
  drawMode,
  externalViewportPan,
  externalViewportZoom,
  colorAdjustment,
  onDrawModeChange,
  onCellMouseDown,
  onCellMouseEnter,
  onGlobalMouseUp,
  onSelectColor,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panStartRef = useRef<{
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
    offsetX: number;
    offsetY: number;
    canScrollX: boolean;
    canScrollY: boolean;
  } | null>(null);
  const touchPointerIdRef = useRef<number | null>(null);
  const pinchGestureRef = useRef<{ baseDistance: number; baseZoom: number } | null>(null);
  const activeTouchPointsRef = useRef(new Map<number, { clientX: number; clientY: number }>());
  const spacePressedRef = useRef(false);
  const freePanOffsetRef = useRef({ x: 0, y: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [manualZoom, setManualZoom] = useState<number | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [freePanOffset, setFreePanOffset] = useState({ x: 0, y: 0 });
  const [isColorPopoverOpen, setIsColorPopoverOpen] = useState(false);
  const colorPopoverRef = useRef<HTMLDivElement>(null);
  const isColorPopoverVisible = isColorPopoverOpen && Boolean(colorAdjustment?.enabled);

  const colorLabelMap = useMemo(() => buildColorLabelMap(gridState.cells), [gridState.cells]);
  const previewKeySet = useMemo(
    () => new Set(previewPoints.map((point) => `${point.x},${point.y}`)),
    [previewPoints],
  );
  const selectionKeySet = useMemo(
    () => new Set(selectionPoints.map((point) => `${point.x},${point.y}`)),
    [selectionPoints],
  );
  const hoverPreviewMap = useMemo(
    () => new Map(hoverLayerPreview.map((point) => [`${point.x},${point.y}`, point.color])),
    [hoverLayerPreview],
  );

  const fitZoom = useMemo(() => {
    const { width, height } = gridState.config;
    if (!viewportSize.width || !viewportSize.height) {
      return 1;
    }

    const availableWidth = Math.max(240, viewportSize.width - 32);
    const availableHeight = Math.max(220, viewportSize.height - 32);
    const fitByWidth = availableWidth / Math.max(1, width * BASE_CELL_SIZE + 48);
    const fitByHeight = availableHeight / Math.max(1, height * BASE_CELL_SIZE + 48);

    return Math.max(0.35, Math.min(1.4, Math.min(fitByWidth, fitByHeight)));
  }, [gridState.config, viewportSize.height, viewportSize.width]);

  const zoom = manualZoom ?? fitZoom;
  // Use floor + lower min bound so fit-zoom can truly fit small viewports.
  const cellSize = Math.max(4, Math.floor(BASE_CELL_SIZE * zoom));
  const { width, height } = gridState.config;
  const gutter = viewMode === 'color' ? 0 : Math.max(24, Math.floor(cellSize * 1.5));
  const canvasWidth = gutter + (width * cellSize) + 1;
  const canvasHeight = gutter + (height * cellSize) + 1;
  const strokeWidth = zoom >= 1.4 ? 1 : 0.7;
  const canScrollX = canvasWidth > Math.max(0, viewportSize.width - 1);
  const canScrollY = canvasHeight > Math.max(0, viewportSize.height - 1);
  const freePanLimitX = Math.max(FREE_PAN_MIN, Math.max(0, (viewportSize.width - canvasWidth) / 2) + FREE_PAN_EXTRA);
  const freePanLimitY = Math.max(FREE_PAN_MIN, Math.max(0, (viewportSize.height - canvasHeight) / 2) + FREE_PAN_EXTRA);

  const updateFreePanOffset = useCallback((next: { x: number; y: number }) => {
    const normalized = {
      x: clampFreePanOffset(next.x, freePanLimitX),
      y: clampFreePanOffset(next.y, freePanLimitY),
    };
    freePanOffsetRef.current = normalized;
    setFreePanOffset(normalized);
  }, [freePanLimitX, freePanLimitY]);

  useEffect(() => {
    if (!externalViewportPan) {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const { dx, dy } = externalViewportPan;
    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);

    if (dx) {
      if (canScrollX) {
        viewport.scrollLeft = Math.max(0, Math.min(maxScrollLeft, viewport.scrollLeft - dx));
      } else {
        updateFreePanOffset({ x: freePanOffsetRef.current.x + dx, y: freePanOffsetRef.current.y });
      }
    }

    if (dy) {
      if (canScrollY) {
        viewport.scrollTop = Math.max(0, Math.min(maxScrollTop, viewport.scrollTop - dy));
      } else {
        updateFreePanOffset({ x: freePanOffsetRef.current.x, y: freePanOffsetRef.current.y + dy });
      }
    }
  }, [externalViewportPan, canScrollX, canScrollY, updateFreePanOffset]);

  useEffect(() => {
    if (!externalViewportZoom) {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const previousZoom = manualZoom ?? fitZoom;
    const factor = externalViewportZoom.factor;
    const nextZoom = clampZoom(previousZoom * factor);
    if (Math.abs(nextZoom - previousZoom) < 0.001) {
      return;
    }

    // Anchor zoom at viewport center (mirrors the wheel-zoom behavior without an event cursor).
    const cursorOffsetX = viewport.clientWidth / 2;
    const cursorOffsetY = viewport.clientHeight / 2;
    const nextCellSize = Math.max(4, Math.floor(BASE_CELL_SIZE * nextZoom));
    const nextGutter = viewMode === 'color' ? 0 : Math.max(24, Math.floor(nextCellSize * 1.5));
    const nextCanvasWidth = nextGutter + (width * nextCellSize) + 1;
    const nextCanvasHeight = nextGutter + (height * nextCellSize) + 1;
    const nextScrollLeft = computeAnchoredScrollOffset({
      viewportSize: viewport.clientWidth,
      cursorOffset: cursorOffsetX,
      scrollOffset: viewport.scrollLeft,
      previousCanvasSize: canvasWidth,
      nextCanvasSize: nextCanvasWidth,
      previousCellSize: cellSize,
      nextCellSize,
      previousGutter: gutter,
      nextGutter,
    });
    const nextScrollTop = computeAnchoredScrollOffset({
      viewportSize: viewport.clientHeight,
      cursorOffset: cursorOffsetY,
      scrollOffset: viewport.scrollTop,
      previousCanvasSize: canvasHeight,
      nextCanvasSize: nextCanvasHeight,
      previousCellSize: cellSize,
      nextCellSize,
      previousGutter: gutter,
      nextGutter,
    });

    requestAnimationFrame(() => {
      setManualZoom(nextZoom);
      viewport.scrollLeft = nextScrollLeft;
      viewport.scrollTop = nextScrollTop;
    });
  }, [externalViewportZoom, canvasHeight, canvasWidth, cellSize, fitZoom, gutter, height, manualZoom, viewMode, width]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const update = () => {
      setViewportSize({
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      });
    };

    update();
    const observer = new ResizeObserver(() => {
      update();
    });
    observer.observe(viewport);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const next = {
      x: canScrollX ? 0 : freePanOffsetRef.current.x,
      y: canScrollY ? 0 : freePanOffsetRef.current.y,
    };
    if (next.x !== freePanOffsetRef.current.x || next.y !== freePanOffsetRef.current.y) {
      const frame = window.requestAnimationFrame(() => {
        updateFreePanOffset(next);
      });
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [canScrollX, canScrollY, updateFreePanOffset]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !spacePressedRef.current) {
        spacePressedRef.current = true;
        setIsSpacePressed(true);
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spacePressedRef.current = false;
        setIsSpacePressed(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    const gridX = gutter;
    const gridY = gutter;
    const gridWidth = width * cellSize;
    const gridHeight = height * cellSize;

    ctx.fillStyle = '#faf7f2';
    ctx.fillRect(gridX, gridY, gridWidth, gridHeight);

    const paintCells = () => {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const cell = gridState.cells[y][x];
          const px = gridX + (x * cellSize);
          const py = gridY + (y * cellSize);

          if (viewMode === 'color') {
            ctx.fillStyle = cell?.hex ?? '#ffffff';
            ctx.fillRect(px, py, cellSize, cellSize);
          } else if (viewMode === 'number') {
            if (cell) {
              const codeLabel = colorLabelMap.get(cell.hex) ?? 'C1';
              const cellStyle = getPatternNumberCellStyle(cell.hex);
              const labelStyle = getPatternCellTextStyle('number', cellSize);
              const fontSize = codeLabel.length >= 3 ? Math.max(8, labelStyle.fontSize - 2) : labelStyle.fontSize;
              ctx.fillStyle = cellStyle.fillColor;
              ctx.fillRect(px, py, cellSize, cellSize);
              ctx.fillStyle = cellStyle.textColor;
              ctx.font = `700 ${fontSize}px sans-serif`;
              ctx.fillText(codeLabel, px + (cellSize / 2), py + (cellSize / 2));
            } else {
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(px, py, cellSize, cellSize);
            }
          } else if (cell) {
            ctx.save();
            ctx.globalAlpha = 0.56;
            ctx.fillStyle = cell.hex;
            ctx.fillRect(px, py, cellSize, cellSize);
            ctx.restore();

            if (zoom >= 1.1) {
              const codeLabel = colorLabelMap.get(cell.hex) ?? 'C1';
              const labelStyle = getPatternCellTextStyle('overlay', cellSize);
              const fontSize = codeLabel.length >= 3 ? Math.max(7, labelStyle.fontSize - 1) : labelStyle.fontSize;
              ctx.fillStyle = labelStyle.textColor;
              ctx.font = `700 ${fontSize}px sans-serif`;
              ctx.fillText(codeLabel, px + (cellSize / 2), py + (cellSize / 2));
            }
          }

          const verticalLineStyle = getPatternGridLineStyle(viewMode, x, strokeWidth);
          const horizontalLineStyle = getPatternGridLineStyle(viewMode, y, strokeWidth);
          const isMajorLine = verticalLineStyle.lineWidth > strokeWidth || horizontalLineStyle.lineWidth > strokeWidth;
          ctx.strokeStyle = isMajorLine ? '#c5b8a5' : verticalLineStyle.strokeStyle;
          ctx.lineWidth = Math.max(verticalLineStyle.lineWidth, horizontalLineStyle.lineWidth);
          ctx.strokeRect(px, py, cellSize, cellSize);
        }
      }

      if (gutter > 0) {
        ctx.fillStyle = '#6b7280';
        ctx.font = `${Math.max(10, Math.floor(cellSize * 0.35))}px sans-serif`;

        for (let x = 0; x < width; x++) {
          if (width > 20 && x % 5 !== 0 && x !== width - 1) {
            continue;
          }

          ctx.fillText(
            String(x + 1),
            gridX + (x * cellSize) + (cellSize / 2),
            gutter / 2,
          );
        }

        for (let y = 0; y < height; y++) {
          if (height > 20 && y % 5 !== 0 && y !== height - 1) {
            continue;
          }

          ctx.fillText(
            String(y + 1),
            gutter / 2,
            gridY + (y * cellSize) + (cellSize / 2),
          );
        }
      }
    };

    const drawPreview = () => {
      if (previewKeySet.size === 0) {
        return;
      }

      for (const key of previewKeySet) {
        const [xText, yText] = key.split(',');
        const x = Number.parseInt(xText, 10);
        const y = Number.parseInt(yText, 10);

        if (x < 0 || y < 0 || x >= width || y >= height) {
          continue;
        }

        const px = gridX + (x * cellSize);
        const py = gridY + (y * cellSize);

        ctx.save();
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = previewColor?.hex ?? '#111827';
        ctx.fillRect(px, py, cellSize, cellSize);
        ctx.restore();

        ctx.save();
        ctx.strokeStyle = previewColor ? '#f97316' : '#374151';
        ctx.lineWidth = Math.max(1, strokeWidth * 1.6);
        ctx.strokeRect(px + 1, py + 1, Math.max(2, cellSize - 2), Math.max(2, cellSize - 2));
        ctx.restore();
      }
    };

    const drawHoveredLayer = () => {
      if (hoverPreviewMap.size === 0) {
        return;
      }

      ctx.save();
      ctx.globalAlpha = 0.52;
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(gridX, gridY, gridWidth, gridHeight);
      ctx.restore();

      for (const [key, color] of hoverPreviewMap) {
        const [xText, yText] = key.split(',');
        const x = Number.parseInt(xText, 10);
        const y = Number.parseInt(yText, 10);
        if (x < 0 || y < 0 || x >= width || y >= height) {
          continue;
        }

        const px = gridX + (x * cellSize);
        const py = gridY + (y * cellSize);

        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = color.hex;
        ctx.fillRect(px, py, cellSize, cellSize);
        ctx.restore();

        ctx.save();
        ctx.strokeStyle = '#f97316';
        ctx.lineWidth = Math.max(1, strokeWidth * 1.4);
        ctx.strokeRect(px + 0.5, py + 0.5, Math.max(1, cellSize - 1), Math.max(1, cellSize - 1));
        ctx.restore();
      }
    };

    const drawSelection = () => {
      if (selectionKeySet.size === 0) {
        return;
      }

      ctx.save();
      ctx.setLineDash([4, 3]);
      for (const key of selectionKeySet) {
        const [xText, yText] = key.split(',');
        const x = Number.parseInt(xText, 10);
        const y = Number.parseInt(yText, 10);
        if (x < 0 || y < 0 || x >= width || y >= height) {
          continue;
        }

        const px = gridX + (x * cellSize);
        const py = gridY + (y * cellSize);
        ctx.strokeStyle = '#4338ca';
        ctx.lineWidth = Math.max(1, strokeWidth * 1.35);
        ctx.strokeRect(px + 0.5, py + 0.5, Math.max(1, cellSize - 1), Math.max(1, cellSize - 1));
      }
      ctx.restore();
    };

    if (viewMode === 'overlay' && overlayImage) {
      const image = new Image();
      image.onload = () => {
        ctx.save();
        ctx.globalAlpha = overlayOpacity;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(image, gridX, gridY, gridWidth, gridHeight);
        ctx.restore();
        paintCells();
        drawHoveredLayer();
        drawPreview();
        drawSelection();
      };
      image.src = overlayImage;
      return;
    }

    paintCells();
    drawHoveredLayer();
    drawPreview();
    drawSelection();
  }, [canvasHeight, canvasWidth, cellSize, colorLabelMap, gridState.cells, gridState.config, gutter, hoverPreviewMap, overlayImage, overlayOpacity, previewColor, previewKeySet, selectionKeySet, strokeWidth, viewMode, width, height, zoom]);

  const getGridPosition = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return { x: -1, y: -1 };
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const rawX = ((e.clientX - rect.left) * scaleX) - gutter;
    const rawY = ((e.clientY - rect.top) * scaleY) - gutter;

    return {
      x: Math.floor(rawX / cellSize),
      y: Math.floor(rawY / cellSize),
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (shouldStartViewportPanning({
      button: e.button,
      isSpacePressed: spacePressedRef.current,
      isPanMode: drawMode === 'pan',
    })) {
      return;
    }

    const { x, y } = getGridPosition(e);
    if (x < 0 || x >= gridState.config.width || y < 0 || y >= gridState.config.height) {
      return;
    }

    if (e.altKey || e.button === 2) {
      const cell = gridState.cells[y][x];
      if (cell) {
        onSelectColor(cell);
      }
      return;
    }

    onCellMouseDown(x, y);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (panStartRef.current) {
      return;
    }

    const { x, y } = getGridPosition(e);
    if (x >= 0 && x < gridState.config.width && y >= 0 && y < gridState.config.height) {
      onCellMouseEnter(x, y);
    }
  };

  const zoomLabel = `${Math.round(zoom * 100)}%`;

  const handleViewportWheel = useCallback((event: WheelEvent) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const deltaScale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1;
    const normalizedDeltaX = event.deltaX * deltaScale;
    const normalizedDeltaY = event.deltaY * deltaScale;

    // Trackpad/mouse-wheel scrolling should pan the viewport naturally.
    // Only intercept explicit zoom gestures (pinch or modifier-assisted wheel).
    const shouldZoom = event.ctrlKey || event.metaKey;
    if (!shouldZoom) {
      let effectiveDeltaX = normalizedDeltaX;
      if (
        Math.abs(effectiveDeltaX) < TRACKPAD_DELTA_FALLBACK_THRESHOLD
        && Math.abs(normalizedDeltaY) > TRACKPAD_DELTA_FALLBACK_THRESHOLD
        && !canScrollY
      ) {
        // Some devices/browsers report horizontal gestures as deltaY when there is no vertical scroll context.
        effectiveDeltaX = normalizedDeltaY;
      }
      const nextOffset = {
        x: freePanOffsetRef.current.x,
        y: freePanOffsetRef.current.y,
      };
      if (!canScrollX && Math.abs(effectiveDeltaX) > 0) {
        nextOffset.x = freePanOffsetRef.current.x - (effectiveDeltaX * TRACKPAD_PAN_MULTIPLIER);
      }
      if (!canScrollY && Math.abs(normalizedDeltaY) > 0) {
        nextOffset.y = freePanOffsetRef.current.y - (normalizedDeltaY * TRACKPAD_PAN_MULTIPLIER);
      }
      if (nextOffset.x !== freePanOffsetRef.current.x || nextOffset.y !== freePanOffsetRef.current.y) {
        event.preventDefault();
        updateFreePanOffset(nextOffset);
      }
      return;
    }

    event.preventDefault();
    if (freePanOffsetRef.current.x !== 0 || freePanOffsetRef.current.y !== 0) {
      updateFreePanOffset({ x: 0, y: 0 });
    }

    const previousZoom = manualZoom ?? fitZoom;
    const factor = normalizedDeltaY < 0 ? 1.08 : 0.92;
    const nextZoom = clampZoom(previousZoom * factor);
    if (Math.abs(nextZoom - previousZoom) < 0.001) {
      return;
    }

    const rect = viewport.getBoundingClientRect();
    const cursorOffsetX = event.clientX - rect.left;
    const cursorOffsetY = event.clientY - rect.top;
    const nextCellSize = Math.max(4, Math.floor(BASE_CELL_SIZE * nextZoom));
    const nextGutter = viewMode === 'color' ? 0 : Math.max(24, Math.floor(nextCellSize * 1.5));
    const nextCanvasWidth = nextGutter + (width * nextCellSize) + 1;
    const nextCanvasHeight = nextGutter + (height * nextCellSize) + 1;
    const nextScrollLeft = computeAnchoredScrollOffset({
      viewportSize: viewport.clientWidth,
      cursorOffset: cursorOffsetX,
      scrollOffset: viewport.scrollLeft,
      previousCanvasSize: canvasWidth,
      nextCanvasSize: nextCanvasWidth,
      previousCellSize: cellSize,
      nextCellSize,
      previousGutter: gutter,
      nextGutter,
    });
    const nextScrollTop = computeAnchoredScrollOffset({
      viewportSize: viewport.clientHeight,
      cursorOffset: cursorOffsetY,
      scrollOffset: viewport.scrollTop,
      previousCanvasSize: canvasHeight,
      nextCanvasSize: nextCanvasHeight,
      previousCellSize: cellSize,
      nextCellSize,
      previousGutter: gutter,
      nextGutter,
    });

    setManualZoom(nextZoom);
    requestAnimationFrame(() => {
      viewport.scrollLeft = nextScrollLeft;
      viewport.scrollTop = nextScrollTop;
    });
  }, [canScrollX, canScrollY, canvasHeight, canvasWidth, cellSize, fitZoom, gutter, height, manualZoom, updateFreePanOffset, viewMode, width]);

  const handleViewportMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const isCanvasTarget = event.target instanceof HTMLCanvasElement;

    const shouldPan = shouldStartViewportPanning({
      button: event.button,
      isSpacePressed: spacePressedRef.current,
      isCanvasTarget,
      isPanMode: drawMode === 'pan',
    });
    if (!shouldPan) {
      return;
    }

    event.preventDefault();
    panStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      offsetX: freePanOffsetRef.current.x,
      offsetY: freePanOffsetRef.current.y,
      canScrollX,
      canScrollY,
    };
    setIsPanning(true);
  };

  const startViewportPanning = useCallback((clientX: number, clientY: number, viewport: HTMLDivElement) => {
    panStartRef.current = {
      x: clientX,
      y: clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      offsetX: freePanOffsetRef.current.x,
      offsetY: freePanOffsetRef.current.y,
      canScrollX,
      canScrollY,
    };
    setIsPanning(true);
  }, [canScrollX, canScrollY]);

  const stopViewportPanning = useCallback(() => {
    panStartRef.current = null;
    touchPointerIdRef.current = null;
    setIsPanning(false);
  }, []);

  const getActiveTouchPair = useCallback(() => {
    const points = Array.from(activeTouchPointsRef.current.values());
    if (points.length < 2) {
      return null;
    }

    return [points[0]!, points[1]!] as const;
  }, []);

  const startPinchGesture = useCallback(() => {
    const touchPair = getActiveTouchPair();
    if (!touchPair) {
      pinchGestureRef.current = null;
      return;
    }

    const [firstTouch, secondTouch] = touchPair;
    pinchGestureRef.current = {
      baseDistance: Math.max(1, getTouchDistance(firstTouch, secondTouch)),
      baseZoom: manualZoom ?? fitZoom,
    };
    stopViewportPanning();
  }, [fitZoom, getActiveTouchPair, manualZoom, stopViewportPanning]);

  const applyPinchZoom = useCallback((viewport: HTMLDivElement) => {
    const touchPair = getActiveTouchPair();
    const pinchGesture = pinchGestureRef.current;
    if (!touchPair || !pinchGesture) {
      return;
    }

    const [firstTouch, secondTouch] = touchPair;
    const distance = getTouchDistance(firstTouch, secondTouch);
    if (distance <= 0) {
      return;
    }

    const nextZoom = clampZoom(pinchGesture.baseZoom * (distance / pinchGesture.baseDistance));
    if (Math.abs(nextZoom - zoom) < 0.001) {
      return;
    }

    if (freePanOffsetRef.current.x !== 0 || freePanOffsetRef.current.y !== 0) {
      updateFreePanOffset({ x: 0, y: 0 });
    }

    const midpoint = getTouchMidpoint(firstTouch, secondTouch);
    const rect = viewport.getBoundingClientRect();
    const cursorOffsetX = midpoint.x - rect.left;
    const cursorOffsetY = midpoint.y - rect.top;
    const nextCellSize = Math.max(4, Math.floor(BASE_CELL_SIZE * nextZoom));
    const nextGutter = viewMode === 'color' ? 0 : Math.max(24, Math.floor(nextCellSize * 1.5));
    const nextCanvasWidth = nextGutter + (width * nextCellSize) + 1;
    const nextCanvasHeight = nextGutter + (height * nextCellSize) + 1;
    const nextScrollLeft = computeAnchoredScrollOffset({
      viewportSize: viewport.clientWidth,
      cursorOffset: cursorOffsetX,
      scrollOffset: viewport.scrollLeft,
      previousCanvasSize: canvasWidth,
      nextCanvasSize: nextCanvasWidth,
      previousCellSize: cellSize,
      nextCellSize,
      previousGutter: gutter,
      nextGutter,
    });
    const nextScrollTop = computeAnchoredScrollOffset({
      viewportSize: viewport.clientHeight,
      cursorOffset: cursorOffsetY,
      scrollOffset: viewport.scrollTop,
      previousCanvasSize: canvasHeight,
      nextCanvasSize: nextCanvasHeight,
      previousCellSize: cellSize,
      nextCellSize,
      previousGutter: gutter,
      nextGutter,
    });

    setManualZoom(nextZoom);
    requestAnimationFrame(() => {
      viewport.scrollLeft = nextScrollLeft;
      viewport.scrollTop = nextScrollTop;
    });
  }, [canvasHeight, canvasWidth, cellSize, getActiveTouchPair, gutter, height, updateFreePanOffset, viewMode, width, zoom]);

  const handleViewportPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    activeTouchPointsRef.current.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY,
    });

    if (activeTouchPointsRef.current.size === 1) {
      touchPointerIdRef.current = event.pointerId;
      startViewportPanning(event.clientX, event.clientY, viewport);
      return;
    }

    if (activeTouchPointsRef.current.size === 2) {
      startPinchGesture();
    }
  };

  const applyPanFromPointer = useCallback((clientX: number, clientY: number) => {
    const viewport = viewportRef.current;
    const panStart = panStartRef.current;
    if (!viewport || !panStart) {
      return;
    }

    const deltaX = clientX - panStart.x;
    const deltaY = clientY - panStart.y;
    if (panStart.canScrollX) {
      viewport.scrollLeft = panStart.scrollLeft - deltaX;
    }
    if (panStart.canScrollY) {
      viewport.scrollTop = panStart.scrollTop - deltaY;
    }

    if (!panStart.canScrollX || !panStart.canScrollY) {
      const nextOffset = {
        x: panStart.canScrollX ? panStart.offsetX : panStart.offsetX + deltaX,
        y: panStart.canScrollY ? panStart.offsetY : panStart.offsetY + deltaY,
      };
      if (nextOffset.x !== freePanOffsetRef.current.x || nextOffset.y !== freePanOffsetRef.current.y) {
        updateFreePanOffset(nextOffset);
      }
    }
  }, [updateFreePanOffset]);

  const handleViewportMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!panStartRef.current) {
      return;
    }

    event.preventDefault();
    applyPanFromPointer(event.clientX, event.clientY);
  };

  const stopPanning = useCallback(() => {
    pinchGestureRef.current = null;
    stopViewportPanning();
  }, [stopViewportPanning]);

  const handleViewportPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') {
      return;
    }

    if (!activeTouchPointsRef.current.has(event.pointerId)) {
      return;
    }

    activeTouchPointsRef.current.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY,
    });

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    if (activeTouchPointsRef.current.size >= 2) {
      if (!pinchGestureRef.current) {
        startPinchGesture();
      }
      applyPinchZoom(viewport);
      return;
    }

    if (touchPointerIdRef.current !== event.pointerId) {
      return;
    }

    applyPanFromPointer(event.clientX, event.clientY);
  };

  const handleViewportPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') {
      return;
    }

    activeTouchPointsRef.current.delete(event.pointerId);

    if (activeTouchPointsRef.current.size === 0) {
      stopPanning();
      return;
    }

    if (activeTouchPointsRef.current.size === 1) {
      pinchGestureRef.current = null;
      const viewport = viewportRef.current;
      const [remainingPointerId, remainingPoint] = Array.from(activeTouchPointsRef.current.entries())[0]!;
      if (viewport) {
        touchPointerIdRef.current = remainingPointerId;
        startViewportPanning(remainingPoint.clientX, remainingPoint.clientY, viewport);
      }
      return;
    }

    startPinchGesture();
  };

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const onWheel = (event: WheelEvent) => handleViewportWheel(event);
    viewport.addEventListener('wheel', onWheel, { passive: false });

    return () => viewport.removeEventListener('wheel', onWheel);
  }, [handleViewportWheel]);

  useEffect(() => {
    if (!isPanning) {
      return;
    }

    const handleWindowMouseMove = (event: MouseEvent) => {
      applyPanFromPointer(event.clientX, event.clientY);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', stopPanning);
    window.addEventListener('blur', stopPanning);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', stopPanning);
      window.removeEventListener('blur', stopPanning);
    };
  }, [applyPanFromPointer, isPanning, stopPanning]);

  useEffect(() => {
    if (!isColorPopoverOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!colorPopoverRef.current?.contains(event.target as Node)) {
        setIsColorPopoverOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsColorPopoverOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isColorPopoverOpen]);

  const canvasCursor = isPanning
    ? 'grabbing'
    : (
      drawMode === 'pan'
      || isSpacePressed
      || drawMode === 'move'
        ? 'grab'
        : drawMode === 'select'
          ? 'crosshair'
          : 'crosshair'
    );

  return (
    <div
      className="grid h-full w-full grid-rows-[minmax(0,1fr)_auto] gap-3 overflow-hidden rounded-[28px] border border-[#eadfd0] bg-white p-3"
      onMouseUp={onGlobalMouseUp}
      onMouseLeave={onGlobalMouseUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="relative h-full min-h-0">
        <div
          ref={viewportRef}
          onMouseDown={handleViewportMouseDown}
          onMouseMove={handleViewportMouseMove}
          onMouseUp={stopPanning}
          onPointerDown={handleViewportPointerDown}
          onPointerMove={handleViewportPointerMove}
          onPointerUp={handleViewportPointerUp}
          onPointerCancel={handleViewportPointerUp}
          className="absolute inset-0 overflow-auto rounded-[24px] border border-[#e7dcc9] bg-[#f5efe6] p-3 custom-scrollbar"
          style={{ scrollbarGutter: 'stable both-edges', touchAction: 'none' }}
        >
          <div className="relative h-max w-max">
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              className="block rounded-2xl border border-[#dbc8b0] bg-white"
              style={{
                imageRendering: 'pixelated',
                cursor: canvasCursor,
                transform: `translate(${freePanOffset.x}px, ${freePanOffset.y}px)`,
              }}
            />
          </div>
        </div>
        <div className="pointer-events-none absolute bottom-3 right-3 z-20">
          <div className="pointer-events-auto flex items-center gap-1.5 rounded-xl border border-[#e7dcc9] bg-white/96 px-2 py-1 shadow-sm backdrop-blur">
            <button
              type="button"
              onClick={() => {
                updateFreePanOffset({ x: 0, y: 0 });
                setManualZoom((current) => stepZoom(current ?? fitZoom, 'out'));
              }}
              className="rounded-md border border-gray-200 px-1.5 py-0.5 text-xs font-black text-gray-700 transition hover:bg-gray-50"
              title="缩小"
            >
              -
            </button>
            <div className="min-w-10 text-center text-[11px] font-black text-gray-700">{zoomLabel}</div>
            <button
              type="button"
              onClick={() => {
                updateFreePanOffset({ x: 0, y: 0 });
                setManualZoom((current) => stepZoom(current ?? fitZoom, 'in'));
              }}
              className="rounded-md border border-gray-200 px-1.5 py-0.5 text-xs font-black text-gray-700 transition hover:bg-gray-50"
              title="放大"
            >
              +
            </button>
          </div>
        </div>
      </div>
      <div className="grid gap-2 rounded-[22px] border border-[#eadfd0] bg-[#faf6ef]/96 px-3 py-2.5 backdrop-blur-sm">
        <div
          className="-mb-6 overflow-x-auto pb-6 no-scrollbar"
          style={{ touchAction: 'pan-x', overscrollBehaviorX: 'contain' }}
        >
          <div className="flex w-max items-center gap-2 pr-1">
            {TOOL_GROUPS.map((group) => (
              <div key={group.id} className="flex shrink-0 items-center gap-1.5 rounded-xl border border-[#eadfd0] bg-white/70 px-1.5 py-1">
                <span className="rounded-md bg-[#f4efe5] px-1.5 py-0.5 text-[9px] font-black tracking-[0.08em] text-gray-500">
                  {group.label}
                </span>
                {TOOL_BUTTONS.filter((tool) => tool.group === group.id).map((tool) => (
                  <button
                    key={tool.mode}
                    type="button"
                    onClick={() => onDrawModeChange(tool.mode)}
                    aria-label={tool.label}
                    title={tool.label}
                    className={`group relative inline-flex h-8 w-8 items-center justify-center rounded-lg transition ${
                      drawMode === tool.mode ? `${tool.activeClass} shadow-sm` : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {tool.icon(drawMode === tool.mode)}
                    <span className="pointer-events-none absolute left-1/2 top-full z-40 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-1.5 py-1 text-[10px] font-semibold text-white opacity-0 shadow transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      {tool.label}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-[#eadfd0] pt-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 flex-1 text-[10px] font-medium leading-5 text-gray-500">
              提示：
              <kbd className="mx-1 rounded border border-gray-300 bg-white px-1 py-0.5 font-semibold text-gray-600">Ctrl/⌘ + 滚轮</kbd>
              缩放，
              <kbd className="mx-1 rounded border border-gray-300 bg-white px-1 py-0.5 font-semibold text-gray-600">双指捏合</kbd>
              缩放，
              <kbd className="mx-1 rounded border border-gray-300 bg-white px-1 py-0.5 font-semibold text-gray-600">双指滚动</kbd>
              平移，
              <kbd className="mx-1 rounded border border-gray-300 bg-white px-1 py-0.5 font-semibold text-gray-600">右键拖拽</kbd>
              平移，
              <kbd className="mx-1 rounded border border-gray-300 bg-white px-1 py-0.5 font-semibold text-gray-600">框选+移动</kbd>
              搬移内容，
              <kbd className="mx-1 rounded border border-gray-300 bg-white px-1 py-0.5 font-semibold text-gray-600">同色选取</kbd>
              一键选同色，
              <kbd className="mx-1 rounded border border-gray-300 bg-white px-1 py-0.5 font-semibold text-gray-600">平移工具</kbd>
              左键拖拽，
              <kbd className="mx-1 rounded border border-gray-300 bg-white px-1 py-0.5 font-semibold text-gray-600">Space + 拖拽</kbd>
              平移
            </div>
            <div className="flex items-center gap-2">
              {colorAdjustment && (
                <div ref={colorPopoverRef} className="relative shrink-0">
                  <button
                    type="button"
                    aria-label="打开颜色调节"
                    title="颜色调节"
                    disabled={!colorAdjustment.enabled}
                    onClick={() => setIsColorPopoverOpen((current) => !current)}
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black shadow-sm transition ${
                      colorAdjustment.enabled
                        ? 'border-[#d8c6aa] bg-white text-[#8a5a24] hover:-translate-y-0.5 hover:border-[#dd6b20] hover:text-[#dd6b20] hover:shadow'
                        : 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-300'
                    }`}
                  >
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#fff3e6] text-[#dd6b20]">
                      <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="7" />
                        <path d="M12 5v14" />
                        <path d="M12 12h7" />
                      </svg>
                    </span>
                    <span>{colorAdjustment.targetColorMode === 'auto' ? `自动 ${colorAdjustment.recommendedTargetColors}` : `${colorAdjustment.selectedTargetColors} 色`}</span>
                  </button>

                  <div
                    className={`absolute bottom-full right-0 z-50 mb-2 w-[248px] rounded-2xl border border-[#e4d4be] bg-white/98 p-3 shadow-[0_20px_60px_rgba(83,52,24,0.18)] backdrop-blur transition ${
                      isColorPopoverVisible ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none translate-y-1 opacity-0'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[10px] font-bold tracking-[0.18em] text-gray-400">颜色调节</div>
                        <div className="mt-1 text-xs font-black text-gray-800">全局重新试色数</div>
                      </div>
                      <div className="rounded-full bg-[#f6efe4] px-2 py-1 text-[10px] font-black text-[#8a5a24]">
                        4 - 12 色
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={!colorAdjustment.enabled}
                        onClick={colorAdjustment.onApplyAuto}
                        className={`rounded-xl px-3 py-2 text-xs font-bold transition ${
                          colorAdjustment.targetColorMode === 'auto'
                            ? 'bg-orange-500 text-white'
                            : 'border border-gray-200 bg-white text-gray-700'
                        } ${!colorAdjustment.enabled ? 'cursor-not-allowed opacity-45' : ''}`}
                      >
                        自动
                      </button>
                      <div className="flex items-center justify-center rounded-xl border border-dashed border-[#e6d8c6] bg-[#faf8f3] px-3 py-2 text-[11px] font-bold text-gray-600">
                        推荐 {colorAdjustment.recommendedTargetColors} 色
                      </div>
                    </div>

                    <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between text-[11px] font-bold text-gray-500">
                        <span>手动颜色数</span>
                        <span className="text-orange-700">{colorAdjustment.selectedTargetColors}</span>
                      </div>
                      <input
                        type="range"
                        min={colorAdjustment.minTargetColors}
                        max={colorAdjustment.maxTargetColors}
                        step="1"
                        disabled={!colorAdjustment.enabled}
                        value={colorAdjustment.selectedTargetColors}
                        onChange={(event) => colorAdjustment.onApplyManual(Number.parseInt(event.target.value, 10))}
                        className="w-full accent-orange-500"
                      />
                    </div>

                    <p className="mt-2 text-[11px] leading-5 text-gray-500">
                      {colorAdjustment.enabled
                        ? '拖动后会立刻重新生成当前图纸，方便直接对比不同颜色数效果。'
                        : '先导入参考图并生成一次图纸，这里才会接管颜色调节。'}
                    </p>
                  </div>
                </div>
              )}

              <button
                type="button"
                aria-label="适应窗口"
                onClick={() => {
                  const viewport = viewportRef.current;
                  updateFreePanOffset({ x: 0, y: 0 });
                  setManualZoom(null);
                  if (!viewport) {
                    return;
                  }
                  const centerCanvas = () => {
                    const canvas = canvasRef.current;
                    if (!canvas) {
                      return;
                    }
                    const targetScrollLeft = (canvas.scrollWidth - viewport.clientWidth) / 2;
                    const targetScrollTop = (canvas.scrollHeight - viewport.clientHeight) / 2;
                    viewport.scrollLeft = Math.max(0, targetScrollLeft);
                    viewport.scrollTop = Math.max(0, targetScrollTop);
                  };
                  centerCanvas();
                  requestAnimationFrame(centerCanvas);
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#d8c6aa] bg-white px-2.5 py-1 text-[10px] font-black text-[#8a5a24] shadow-sm transition hover:-translate-y-0.5 hover:border-[#dd6b20] hover:text-[#dd6b20] hover:shadow"
              >
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#fff3e6] text-[9px] leading-none text-[#dd6b20]">
                  ⤢
                </span>
                <span>重置视图</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
