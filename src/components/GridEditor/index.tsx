import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Color, DrawMode, GridState } from '../../types';
import { buildColorCodeMap } from '../../utils/pattern';
import { clampZoom, stepZoom } from '../../utils/gridZoom';
import { getPatternCellTextStyle, getPatternGridLineStyle, getPatternNumberCellStyle } from '../../utils/patternCanvas';

export type EditorViewMode = 'color' | 'number' | 'overlay';

const TOOL_BUTTONS: Array<{ mode: DrawMode; label: string; activeClass: string; icon: (active: boolean) => React.ReactNode }> = [
  {
    mode: 'paint',
    label: '画笔',
    activeClass: 'bg-orange-500 text-white',
    icon: (active) => (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 5l5 5" />
        <path d="M4 20l4-1 10-10-3-3L5 16l-1 4z" />
        <path d="M13 7l3 3" className={active ? 'opacity-100' : 'opacity-70'} />
      </svg>
    ),
  },
  {
    mode: 'fill',
    label: '油漆桶',
    activeClass: 'bg-amber-500 text-white',
    icon: () => (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M7 10l6-6 5 5-6 6z" />
        <path d="M4 20h10" />
        <path d="M15 14c0 1.8 1.3 3 3 3s3-1.2 3-3-1.3-3-3-3" />
      </svg>
    ),
  },
  {
    mode: 'pick',
    label: '取色',
    activeClass: 'bg-teal-600 text-white',
    icon: () => (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10 14l-6 6" />
        <path d="M14.5 3a4.5 4.5 0 013.2 7.7l-5.6 5.6-6.3-6.3 5.6-5.6A4.5 4.5 0 0114.5 3z" />
        <circle cx="8" cy="16" r="1" />
      </svg>
    ),
  },
  {
    mode: 'erase',
    label: '橡皮擦',
    activeClass: 'bg-gray-900 text-white',
    icon: () => (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M7 16l7-7 4 4-4 4H9z" />
        <path d="M3 20h18" />
      </svg>
    ),
  },
  {
    mode: 'line',
    label: '直线',
    activeClass: 'bg-sky-600 text-white',
    icon: () => (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 18L20 6" />
        <circle cx="4" cy="18" r="2" />
        <circle cx="20" cy="6" r="2" />
      </svg>
    ),
  },
  {
    mode: 'rectangle',
    label: '矩形填充',
    activeClass: 'bg-sky-600 text-white',
    icon: () => (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="5" y="7" width="14" height="10" rx="1.5" />
      </svg>
    ),
  },
  {
    mode: 'ellipse',
    label: '圆形填充',
    activeClass: 'bg-sky-600 text-white',
    icon: () => (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <ellipse cx="12" cy="12" rx="7" ry="5" />
      </svg>
    ),
  },
  {
    mode: 'triangle',
    label: '三角形填充',
    activeClass: 'bg-sky-600 text-white',
    icon: () => (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 5l8 14H4z" />
      </svg>
    ),
  },
];

interface GridEditorProps {
  gridState: GridState;
  viewMode: EditorViewMode;
  overlayImage: string | null;
  overlayOpacity: number;
  previewPoints: Array<{ x: number; y: number }>;
  previewColor: Color | null;
  drawMode: DrawMode;
  onDrawModeChange: (mode: DrawMode) => void;
  onCellMouseDown: (x: number, y: number) => void;
  onCellMouseEnter: (x: number, y: number) => void;
  onGlobalMouseUp: () => void;
  onSelectColor: (color: Color) => void;
}

const BASE_CELL_SIZE = 18;

export const GridEditor: React.FC<GridEditorProps> = ({
  gridState,
  viewMode,
  overlayImage,
  overlayOpacity,
  previewPoints,
  previewColor,
  drawMode,
  onDrawModeChange,
  onCellMouseDown,
  onCellMouseEnter,
  onGlobalMouseUp,
  onSelectColor,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);
  const spacePressedRef = useRef(false);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [manualZoom, setManualZoom] = useState<number | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);

  const colorCodeMap = useMemo(() => buildColorCodeMap(gridState.cells), [gridState.cells]);
  const previewKeySet = useMemo(
    () => new Set(previewPoints.map((point) => `${point.x},${point.y}`)),
    [previewPoints],
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
  const gutter = viewMode === 'color' ? 0 : Math.max(24, Math.floor(cellSize * 1.5));
  const strokeWidth = zoom >= 1.4 ? 1 : 0.7;

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

    const { width, height } = gridState.config;
    const canvasWidth = gutter + (width * cellSize) + 1;
    const canvasHeight = gutter + (height * cellSize) + 1;

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
              const code = colorCodeMap.get(cell.hex) ?? 0;
              const cellStyle = getPatternNumberCellStyle(cell.hex);
              const labelStyle = getPatternCellTextStyle('number', cellSize);
              ctx.fillStyle = cellStyle.fillColor;
              ctx.fillRect(px, py, cellSize, cellSize);
              ctx.fillStyle = cellStyle.textColor;
              ctx.font = `700 ${labelStyle.fontSize}px sans-serif`;
              ctx.fillText(String(code), px + (cellSize / 2), py + (cellSize / 2));
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
              const code = colorCodeMap.get(cell.hex) ?? 0;
              const labelStyle = getPatternCellTextStyle('overlay', cellSize);
              ctx.fillStyle = labelStyle.textColor;
              ctx.font = `700 ${labelStyle.fontSize}px sans-serif`;
              ctx.fillText(String(code), px + (cellSize / 2), py + (cellSize / 2));
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

    if (viewMode === 'overlay' && overlayImage) {
      const image = new Image();
      image.onload = () => {
        ctx.save();
        ctx.globalAlpha = overlayOpacity;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(image, gridX, gridY, gridWidth, gridHeight);
        ctx.restore();
        paintCells();
        drawPreview();
      };
      image.src = overlayImage;
      return;
    }

    paintCells();
    drawPreview();
  }, [cellSize, colorCodeMap, gridState.cells, gridState.config, gutter, overlayImage, overlayOpacity, previewColor, previewKeySet, strokeWidth, viewMode, zoom]);

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
    const { x, y } = getGridPosition(e);
    if (x >= 0 && x < gridState.config.width && y >= 0 && y < gridState.config.height) {
      onCellMouseEnter(x, y);
    }
  };

  const zoomLabel = `${Math.round(zoom * 100)}%`;

  const handleViewportWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    // Trackpad/mouse-wheel scrolling should pan the viewport naturally.
    // Only intercept explicit zoom gestures (pinch or modifier-assisted wheel).
    const shouldZoom = event.ctrlKey || event.metaKey;
    if (!shouldZoom) {
      return;
    }

    event.preventDefault();

    const previousZoom = manualZoom ?? fitZoom;
    const factor = event.deltaY < 0 ? 1.08 : 0.92;
    const nextZoom = clampZoom(previousZoom * factor);
    if (Math.abs(nextZoom - previousZoom) < 0.001) {
      return;
    }

    const rect = viewport.getBoundingClientRect();
    const cursorOffsetX = event.clientX - rect.left;
    const cursorOffsetY = event.clientY - rect.top;
    const pointerX = viewport.scrollLeft + cursorOffsetX;
    const pointerY = viewport.scrollTop + cursorOffsetY;
    const ratio = nextZoom / previousZoom;

    setManualZoom(nextZoom);
    requestAnimationFrame(() => {
      viewport.scrollLeft = (pointerX * ratio) - cursorOffsetX;
      viewport.scrollTop = (pointerY * ratio) - cursorOffsetY;
    });
  };

  const handleViewportMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const shouldPan = event.button === 1 || spacePressedRef.current;
    if (!shouldPan) {
      return;
    }

    event.preventDefault();
    panStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    setIsPanning(true);
  };

  const handleViewportMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    const panStart = panStartRef.current;
    if (!viewport || !panStart) {
      return;
    }

    event.preventDefault();
    const deltaX = event.clientX - panStart.x;
    const deltaY = event.clientY - panStart.y;
    viewport.scrollLeft = panStart.scrollLeft - deltaX;
    viewport.scrollTop = panStart.scrollTop - deltaY;
  };

  const stopPanning = () => {
    panStartRef.current = null;
    setIsPanning(false);
  };

  const canvasCursor = isPanning ? 'grabbing' : isSpacePressed ? 'grab' : 'crosshair';

  return (
    <div
      className="grid h-full w-full grid-rows-[minmax(0,1fr)_auto] gap-3 overflow-hidden rounded-[28px] border border-[#eadfd0] bg-white p-3"
      onMouseUp={onGlobalMouseUp}
      onMouseLeave={onGlobalMouseUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={viewportRef}
        onWheel={handleViewportWheel}
        onMouseDown={handleViewportMouseDown}
        onMouseMove={handleViewportMouseMove}
        onMouseUp={stopPanning}
        onMouseLeave={stopPanning}
        className="min-h-0 overflow-auto rounded-[24px] border border-[#e7dcc9] bg-[#f5efe6] p-3 custom-scrollbar"
      >
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          className="mx-auto rounded-2xl border border-[#dbc8b0] bg-white"
          style={{ imageRendering: 'pixelated', cursor: canvasCursor }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-[22px] border border-[#eadfd0] bg-[#faf6ef]/96 px-3 py-3 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-2">
          {TOOL_BUTTONS.map((tool) => (
            <button
              key={tool.mode}
              type="button"
              onClick={() => onDrawModeChange(tool.mode)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-bold transition ${
                drawMode === tool.mode ? tool.activeClass : 'border border-gray-200 bg-white text-gray-700'
              }`}
            >
              {tool.icon(drawMode === tool.mode)}
              <span>{tool.label}</span>
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2 rounded-2xl bg-white px-3 py-2">
          <button
            type="button"
            onClick={() => setManualZoom((current) => stepZoom(current ?? fitZoom, 'out'))}
            className="rounded-lg border border-gray-200 px-2 py-1 text-sm font-black text-gray-700 transition hover:bg-gray-50"
            title="缩小"
          >
            -
          </button>
          <div className="min-w-14 text-center text-xs font-black text-gray-700">{zoomLabel}</div>
          <button
            type="button"
            onClick={() => setManualZoom((current) => stepZoom(current ?? fitZoom, 'in'))}
            className="rounded-lg border border-gray-200 px-2 py-1 text-sm font-black text-gray-700 transition hover:bg-gray-50"
            title="放大"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setManualZoom(null)}
            className={`rounded-lg px-3 py-1.5 text-[11px] font-bold transition ${
              manualZoom === null ? 'bg-teal-600 text-white' : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            适应窗口
          </button>
          <button
            type="button"
            onClick={() => setManualZoom(clampZoom(1))}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-bold text-gray-700 transition hover:bg-gray-50"
          >
            100%
          </button>
        </div>
        <div className="w-full border-t border-[#eadfd0] pt-2 text-[10px] font-medium text-gray-500 xl:w-auto xl:border-t-0 xl:pt-0">
          提示：`Ctrl/⌘ + 滚轮` 缩放，双指滚动平移，`Space + 拖拽` 平移
        </div>
      </div>
    </div>
  );
};
