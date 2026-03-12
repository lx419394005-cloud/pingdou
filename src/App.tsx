import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ColorPalette } from './components/ColorPalette';
import { GridEditor, type EditorViewMode } from './components/GridEditor';
import { ImageProcessor } from './components/ImageProcessor';
import { ExportPanel } from './components/ExportPanel';
import { useGridState } from './hooks/useGridState';
import { collectLayerFilledPoints } from './hooks/layerState';
import type { AlgorithmMode, ColorPalette as ColorPaletteType, Color, DrawMode, MirrorMode } from './types';
import mardPalette from './data/colorCards/mard.json';
import { getImportImageSizeError, isImportImageSizeValid } from './utils/importImage';
import { findNearestPaletteColor, sampleOverlayColor } from './utils/colorMatch';
import { parseGridJsonPayload, parseGridJsonText } from './utils/gridJsonImport';
import { MAX_TARGET_COLORS, MIN_TARGET_COLORS } from './algorithms/kMeans';
import { BRAND_DESCRIPTION, BRAND_GITHUB_URL, BRAND_NAME, BRAND_SHORT_NAME, BRAND_XIAOHONGSHU_URL, BRAND_XIAOHONGSHU_LABEL } from './config/brand';

const COLOR_DRIVEN_TOOLS = new Set<DrawMode>(['paint', 'fill', 'line', 'rectangle', 'ellipse', 'triangle', 'text']);
const DRAW_MODE_LABELS: Record<DrawMode, string> = {
  paint: '画笔',
  fill: '油漆桶',
  pick: '取色',
  erase: '橡皮擦',
  select: '框选',
  'select-color': '同色选取',
  move: '移动',
  pan: '平移',
  line: '直线',
  rectangle: '矩形填充',
  ellipse: '圆形填充',
  triangle: '三角形填充',
  text: '文字输入',
};
const MIRROR_MODE_LABELS: Record<MirrorMode, string> = {
  none: '关闭',
  vertical: '左右',
  horizontal: '上下',
  quad: '四向',
};
const APP_VERSION = 'v0.1.0-beta';
type ImportRenderMode = AlgorithmMode | 'json-import';
type ImportColorControlState = {
  hasImage: boolean;
  targetColorMode: 'auto' | 'manual';
  recommendedTargetColors: number;
  selectedTargetColors: number;
  minTargetColors: number;
  maxTargetColors: number;
};

const getColorTextColor = (color: Color | null) => {
  if (!color) {
    return '#111827';
  }

  const { r, g, b } = color.rgb;
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 155 ? '#111827' : '#f8fafc';
};

function App() {
  const {
    gridState,
    composedCells,
    selectedColor,
    setSelectedColor,
    selectPaletteColor,
    drawMode,
    setDrawMode,
    mirrorMode,
    setMirrorMode,
    setPalette,
    handleMouseDown,
    handleMouseEnter,
    handleMouseUp,
    previewPoints,
    previewColor,
    selectionPoints,
    setSelectionPoints,
    loadGridData,
    addLayer,
    setActiveLayer,
    toggleLayerVisibility,
    renameLayer,
    removeLayer,
    undo,
    redo,
    canUndo,
    canRedo,
    setTextInputContent,
  } = useGridState();

  const [viewMode, setViewMode] = useState<EditorViewMode>('color');
  const [overlayOpacity, setOverlayOpacity] = useState(0.55);
  const [overlayImage, setOverlayImage] = useState<string | null>(null);
  const [importPreviewImage, setImportPreviewImage] = useState<string | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isJsonPasteModalOpen, setIsJsonPasteModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [isAboutCardCollapsed, setIsAboutCardCollapsed] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<'edit' | 'palette'>('edit');
  const [isPaletteCollapsed, setIsPaletteCollapsed] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [hoveredLayerId, setHoveredLayerId] = useState<string | null>(null);
  const [customProjectTitle, setCustomProjectTitle] = useState<string | null>(null);
  const [isProjectTitleEditing, setIsProjectTitleEditing] = useState(false);
  const [projectTitleDraft, setProjectTitleDraft] = useState('');
  const [jsonImportDraft, setJsonImportDraft] = useState('');
  const [stageView, setStageView] = useState({ x: 0, y: 0, scale: 1 });
  const [textInputContent, setTextInputContentValue] = useState('');

  useEffect(() => {
    setTextInputContent(textInputContent);
  }, [textInputContent, setTextInputContent]);
  const [editorViewportPan, setEditorViewportPan] = useState<{ requestId: number; dx: number; dy: number }>({
    requestId: 0,
    dx: 0,
    dy: 0,
  });
  const [editorViewportZoom, setEditorViewportZoom] = useState<{ requestId: number; factor: number }>({
    requestId: 0,
    factor: 1,
  });
  const [isStageDragging, setIsStageDragging] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const importJsonInputRef = useRef<HTMLInputElement>(null);
  const lastNonNoneMirrorModeRef = useRef<MirrorMode>('vertical');
  const stageDragRef = useRef<{
    pointerId: number;
    lastClientX: number;
    lastClientY: number;
    moved: boolean;
  } | null>(null);
  const overlaySamplerRef = useRef<{
    src: string;
    width: number;
    height: number;
    data: Uint8ClampedArray;
  } | null>(null);
  const [importStatus, setImportStatus] = useState<{
    sourceName: string | null;
    algorithmMode: ImportRenderMode;
    hasReference: boolean;
    workingResolution: number;
  }>({
    sourceName: null,
    algorithmMode: 'legacy-clean',
    hasReference: false,
    workingResolution: 120,
  });

  useEffect(() => {
    if (mirrorMode !== 'none') {
      lastNonNoneMirrorModeRef.current = mirrorMode;
    }
  }, [mirrorMode]);

  const [importColorControlState, setImportColorControlState] = useState<ImportColorControlState>({
    hasImage: false,
    targetColorMode: 'auto',
    recommendedTargetColors: 6,
    selectedTargetColors: 6,
    minTargetColors: MIN_TARGET_COLORS,
    maxTargetColors: MAX_TARGET_COLORS,
  });
  const importColorActionsRef = useRef<{
    applyAutoTargetColors: () => void;
    applyManualTargetColors: (value: number) => void;
  } | null>(null);
  const [pickSource, setPickSource] = useState<'current' | 'overlay'>('overlay');

  const stats = useMemo(() => {
    const uniqueColors = new Set<string>();
    let totalBeans = 0;

    for (const row of composedCells) {
      for (const cell of row) {
        if (!cell) {
          continue;
        }

        totalBeans += 1;
        uniqueColors.add(cell.hex);
      }
    }

    return {
      totalBeans,
      uniqueColors: uniqueColors.size,
    };
  }, [composedCells]);

  const composedGridState = useMemo(
    () => ({ ...gridState, cells: composedCells }),
    [composedCells, gridState],
  );

  const hoveredLayerPreview = useMemo(() => {
    if (!hoveredLayerId) {
      return [];
    }

    const layer = gridState.layers.find((item) => item.id === hoveredLayerId);
    if (!layer) {
      return [];
    }

    return collectLayerFilledPoints(layer.cells);
  }, [gridState.layers, hoveredLayerId]);

  useEffect(() => {
    if (!gridState.palette) {
      setPalette(mardPalette as ColorPaletteType);
    }
  }, [gridState.palette, setPalette]);

  useEffect(() => {
    if (!isImportModalOpen && !isJsonPasteModalOpen && !isExportModalOpen && !isAboutModalOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsImportModalOpen(false);
        setIsJsonPasteModalOpen(false);
        setIsExportModalOpen(false);
        setIsAboutModalOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAboutModalOpen, isExportModalOpen, isImportModalOpen, isJsonPasteModalOpen]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }

      const tag = target.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || target.isContentEditable;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.key === 'Escape' && (drawMode === 'select' || drawMode === 'move' || drawMode === 'select-color')) {
        event.preventDefault();
        if (selectionPoints.length > 0) {
          setSelectionPoints([]);
        }
        setDrawMode('paint');
        return;
      }

      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') {
        return;
      }

      event.preventDefault();
      if (event.shiftKey) {
        if (canRedo) {
          redo();
        }
        return;
      }

      if (canUndo) {
        undo();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canRedo, canUndo, drawMode, redo, selectionPoints.length, setDrawMode, setSelectionPoints, undo]);

  const handlePaletteLoad = (palette: { id: string; name: string; brand: string; colors: { name: string; hex: string; rgb: { r: number; g: number; b: number } }[] }) => {
    setPalette(palette);
  };

  const handleSelectDrawingColor = (color: Color) => {
    selectPaletteColor(color);
    if (drawMode !== 'select-color' && !COLOR_DRIVEN_TOOLS.has(drawMode)) {
      setDrawMode('paint');
    }
  };

  const handleImportColorControlsChange = useCallback((controls: {
    hasImage: boolean;
    targetColorMode: 'auto' | 'manual';
    recommendedTargetColors: number;
    selectedTargetColors: number;
    minTargetColors: number;
    maxTargetColors: number;
    applyAutoTargetColors: () => void;
    applyManualTargetColors: (value: number) => void;
  }) => {
    importColorActionsRef.current = {
      applyAutoTargetColors: controls.applyAutoTargetColors,
      applyManualTargetColors: controls.applyManualTargetColors,
    };

    setImportColorControlState((current) => {
      const next: ImportColorControlState = {
        hasImage: controls.hasImage,
        targetColorMode: controls.targetColorMode,
        recommendedTargetColors: controls.recommendedTargetColors,
        selectedTargetColors: controls.selectedTargetColors,
        minTargetColors: controls.minTargetColors,
        maxTargetColors: controls.maxTargetColors,
      };

      if (
        current.hasImage === next.hasImage
        && current.targetColorMode === next.targetColorMode
        && current.recommendedTargetColors === next.recommendedTargetColors
        && current.selectedTargetColors === next.selectedTargetColors
        && current.minTargetColors === next.minTargetColors
        && current.maxTargetColors === next.maxTargetColors
      ) {
        return current;
      }

      return next;
    });
  }, []);

  const handleGridLoaded = (
    cells: ({ name: string; hex: string; rgb: { r: number; g: number; b: number } } | null)[][],
    width: number,
    height: number,
    nextOverlayImage: string | null,
  ) => {
    loadGridData(cells, { width, height });
    setOverlayImage(nextOverlayImage);
    setViewMode('color');
    setIsImportModalOpen(false);
  };

  const requestImportImage = () => {
    importFileInputRef.current?.click();
  };

  const openJsonImportModal = () => {
    setJsonImportDraft('');
    setIsJsonPasteModalOpen(true);
  };

  const applyImportedGrid = (
    result: ReturnType<typeof parseGridJsonPayload>,
    sourceName: string,
  ) => {
    setPalette(result.palette);
    loadGridData(result.cells, result.config);
    setOverlayImage(null);
    setImportPreviewImage(null);
    setViewMode('color');
    setPendingImportFile(null);
    setImportStatus({
      sourceName,
      algorithmMode: 'json-import',
      hasReference: true,
      workingResolution: result.config.width,
    });
    setIsImportModalOpen(false);
  };

  const handleImportFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!isImportImageSizeValid(file)) {
      window.alert(getImportImageSizeError(file));
      event.target.value = '';
      return;
    }

    setPendingImportFile(file);
    setIsImportModalOpen(true);
    event.target.value = '';
  };

  const handleImportJsonSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const result = parseGridJsonText(loadEvent.target?.result as string, gridState.config, gridState.palette);
        applyImportedGrid(result, file.name);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'JSON 导入失败';
        window.alert(message);
      }
    };
    reader.onerror = () => {
      window.alert(`读取 JSON 失败：${file.name}`);
    };
    reader.readAsText(file, 'utf-8');
    event.target.value = '';
  };

  const handleImportJsonText = () => {
    try {
      const result = parseGridJsonText(jsonImportDraft, gridState.config, gridState.palette);
      applyImportedGrid(result, '粘贴 JSON');
      setJsonImportDraft('');
      setIsJsonPasteModalOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'JSON 导入失败';
      window.alert(message);
    }
  };

  const paletteColors = gridState.palette?.colors ?? [];

  const loadOverlaySampler = async (src: string) => {
    const image = new Image();
    const loaded = await new Promise<HTMLImageElement | null>((resolve) => {
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = src;
    });
    if (!loaded) {
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, loaded.naturalWidth || loaded.width);
    canvas.height = Math.max(1, loaded.naturalHeight || loaded.height);
    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }
    context.drawImage(loaded, 0, 0, canvas.width, canvas.height);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    return {
      src,
      width: canvas.width,
      height: canvas.height,
      data: imageData.data,
    };
  };

  const handleEditorMouseDown = (x: number, y: number) => {
    if (drawMode !== 'pick') {
      handleMouseDown(x, y);
      return;
    }

    const useOverlay = pickSource === 'overlay' && viewMode === 'overlay' && overlayImage;
    
    if (useOverlay) {
      void (async () => {
        let sampler = overlaySamplerRef.current;
        if (!sampler || sampler.src !== overlayImage) {
          sampler = await loadOverlaySampler(overlayImage);
          if (!sampler) {
            handleMouseDown(x, y);
            return;
          }
          overlaySamplerRef.current = sampler;
        }

        const rgb = sampleOverlayColor(sampler, x, y, gridState.config);
        const nearest = findNearestPaletteColor(rgb, paletteColors, true);
        if (!nearest) {
          handleMouseDown(x, y);
          return;
        }

        setSelectedColor(nearest);
        setDrawMode('paint');
      })();
      return;
    }

    const cell = composedCells[y]?.[x] ?? null;
    if (cell && paletteColors.length > 0) {
      const nearest = findNearestPaletteColor(cell.rgb, paletteColors, false);
      if (nearest) {
        setSelectedColor(nearest);
        setDrawMode('paint');
        return;
      }
    }
    
    handleMouseDown(x, y);
  };

  const currentRenderLabel = (() => {
    if (importStatus.algorithmMode === 'legacy-nearest') return '最近色直出';
    if (importStatus.algorithmMode === 'legacy-guided') return '细节引导';
    if (importStatus.algorithmMode === 'contour-locked') return '轮廓锁定（多尺度）';
    if (importStatus.algorithmMode === 'ink-outline-fill') return '黑线稿填色（实验）';
    if (importStatus.algorithmMode === 'json-import') return 'JSON 坐标导入';
    return '主体清理优先';
  })();
  const activeLayer = gridState.layers.find((layer) => layer.id === gridState.activeLayerId) ?? null;
  const visibleLayerCount = gridState.layers.filter((layer) => layer.visible).length;
  const projectTitle = customProjectTitle ?? importStatus.sourceName ?? `${BRAND_SHORT_NAME}的新图纸`;

  const beginProjectTitleEdit = () => {
    setProjectTitleDraft(projectTitle);
    setIsProjectTitleEditing(true);
  };

  const commitProjectTitleEdit = () => {
    const trimmed = projectTitleDraft.trim();
    if (!trimmed) {
      setCustomProjectTitle(null);
      setProjectTitleDraft('');
      setIsProjectTitleEditing(false);
      return;
    }
    setCustomProjectTitle(trimmed);
    setProjectTitleDraft(trimmed);
    setIsProjectTitleEditing(false);
  };

  const cancelProjectTitleEdit = () => {
    setProjectTitleDraft(projectTitle);
    setIsProjectTitleEditing(false);
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#fdf8ee_0%,#f2e8d8_42%,#ecdfcd_100%)] text-gray-800 lg:h-screen lg:overflow-hidden">
      <header className="sticky top-0 z-20 border-b border-[#e8dbc8] bg-white/94 backdrop-blur">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 sm:px-5 md:grid-cols-[auto_minmax(0,1fr)_auto]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border-2 border-[#9a4a16] bg-[#f08a34] text-white shadow-[0_10px_24px_rgba(212,96,29,0.18)] sm:h-11 sm:w-11">
              <svg className="h-7 w-7" viewBox="0 0 64 64" fill="none" aria-hidden="true">
                <path d="M17 26c0-9.4 7.6-17 17-17 5.8 0 10.3 1.9 13.7 5.8 3.6 4 5.3 8.8 5.3 14.8 0 10.9-8.7 19.4-20 19.4-6.9 0-11.5-1.8-15.1-5.8L11 48l3.7-8.1A21 21 0 0 1 17 26Z" fill="#7fd6c5" stroke="#9a4a16" strokeWidth="4" strokeLinejoin="round"/>
                <path d="M29 13l4.2-7 5.4 8.2" fill="#f9d27c" stroke="#9a4a16" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M42 14l6.8-4.3-1.2 8.8" fill="#f9d27c" stroke="#9a4a16" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="29" cy="28" r="3.7" fill="#1f2937"/>
                <circle cx="43" cy="28" r="3.7" fill="#1f2937"/>
                <path d="M31 40c2.1 1.7 4.2 2.4 6.4 2.4 2.2 0 4.2-.7 6.2-2.4" stroke="#9a4a16" strokeWidth="4" strokeLinecap="round"/>
                <circle cx="23.5" cy="36.5" r="2.5" fill="#f7a6b8"/>
                <circle cx="49.5" cy="36.5" r="2.5" fill="#f7a6b8"/>
                <path d="M18.5 20.5 23 17" stroke="#9a4a16" strokeWidth="4" strokeLinecap="round"/>
              </svg>
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[21px] font-black tracking-tight text-gray-900 sm:text-[25px]">{BRAND_NAME}</h1>
              <p className="truncate text-[11px] font-medium text-gray-500 sm:text-xs">{BRAND_DESCRIPTION}</p>
            </div>
          </div>

          <div className="hidden min-w-0 rounded-2xl border border-[#efe3d2] bg-[#fbf7f0] px-3 py-2 md:block">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-gray-700">
              {isProjectTitleEditing ? (
                <label className="flex min-w-0 items-center gap-1">
                  <span>工程：</span>
                  <input
                    autoFocus
                    value={projectTitleDraft}
                    onChange={(event) => setProjectTitleDraft(event.target.value)}
                    onBlur={commitProjectTitleEdit}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commitProjectTitleEdit();
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        cancelProjectTitleEdit();
                      }
                    }}
                    className="min-w-0 flex-1 rounded-md border border-orange-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-gray-800 outline-none ring-0 focus:border-orange-400"
                  />
                </label>
              ) : (
                <button
                  type="button"
                  onDoubleClick={beginProjectTitleEdit}
                  title="双击修改工程名"
                  className="max-w-[180px] truncate text-left"
                >
                  工程：{projectTitle}
                </button>
              )}
              <span className="text-gray-400">|</span>
              <span>模式：{currentRenderLabel}</span>
              <span className="text-gray-400">|</span>
              <span>图层：{visibleLayerCount}/{gridState.layers.length} 可见</span>
              <span className="text-gray-400">|</span>
              <span className="truncate">当前：{activeLayer?.name ?? '无'}</span>
            </div>
            <p className="mt-1 text-[10px] font-medium text-gray-500">提示：悬停图层可快速预览单层内容，方便检查描线和补豆。</p>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={requestImportImage}
              className="rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1.5 text-[11px] font-bold text-orange-700 transition hover:bg-orange-100 sm:px-3"
            >
              <span className="sm:hidden">导入</span>
              <span className="hidden sm:inline">导入图片</span>
            </button>
            <button
              type="button"
              onClick={openJsonImportModal}
              className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-[11px] font-bold text-teal-700 transition hover:bg-teal-100 sm:px-3"
            >
              <span className="sm:hidden">JSON</span>
              <span className="hidden sm:inline">导入 JSON</span>
            </button>
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              aria-label="撤销（Command/Ctrl+Z）"
              title="撤销（Command/Ctrl+Z）"
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition ${
                canUndo ? 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50' : 'cursor-not-allowed bg-gray-100 text-gray-300'
              }`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 14L4 9l5-5" />
                <path d="M20 20a9 9 0 00-9-9H4" />
              </svg>
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              aria-label="重做（Shift+Command/Ctrl+Z）"
              title="重做（Shift+Command/Ctrl+Z）"
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition ${
                canRedo ? 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50' : 'cursor-not-allowed bg-gray-100 text-gray-300'
              }`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 14l5-5-5-5" />
                <path d="M4 20a9 9 0 019-9h7" />
              </svg>
            </button>
          </div>
        </div>

        <div className="border-t border-[#f1e6d8] px-3 py-2 md:hidden">
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            <span className="max-w-[120px] shrink-0 truncate rounded-full border border-[#eadfd0] bg-[#fbf7f0] px-3 py-1 text-[11px] font-semibold text-gray-700">
              工程：{projectTitle}
            </span>
            <span className="shrink-0 rounded-full border border-[#eadfd0] bg-[#fbf7f0] px-3 py-1 text-[11px] font-semibold text-gray-700">
              模式：{currentRenderLabel}
            </span>
            <span className="shrink-0 rounded-full border border-[#eadfd0] bg-[#fbf7f0] px-3 py-1 text-[11px] font-semibold text-gray-700">
              图层：{visibleLayerCount}/{gridState.layers.length}
            </span>
            <span className="shrink-0 rounded-full border border-[#eadfd0] bg-[#fbf7f0] px-3 py-1 text-[11px] font-semibold text-gray-700">
              当前：{activeLayer?.name ?? '无'}
            </span>
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-col gap-3 overflow-y-auto px-3 py-3 lg:grid lg:h-[calc(100vh-5.8rem)] lg:grid-cols-[minmax(0,1fr)_336px] lg:overflow-hidden">
        <section className="order-1 flex min-h-0 min-w-0 flex-col gap-3 lg:order-none">
          <div className="flex min-h-0 flex-col gap-3 lg:grid lg:h-full lg:grid-cols-[240px_minmax(0,1fr)]">
            <div className="order-2 rounded-[26px] border border-[#e8dcc8] bg-white/96 p-3 lg:order-none">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-black text-gray-800">参考图舞台</h3>
                  <p className="text-[11px] font-medium text-gray-500">查看当前裁切、缩放后的构图位置</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsImportModalOpen(true)}
                  className="min-w-[84px] whitespace-nowrap rounded-full border border-gray-200 bg-white px-3.5 py-2 text-xs font-bold leading-none text-gray-700 transition hover:bg-[#faf7f1]"
                >
                  调整
                </button>
              </div>

              {importPreviewImage ? (
                <button
                  type="button"
                  onClick={() => {
                    if (stageDragRef.current?.moved) {
                      stageDragRef.current = null;
                      return;
                    }
                    setIsImportModalOpen(true);
                  }}
                  onWheel={(event) => {
                    // Zoom the stage freely without requiring modifier keys, and sync zoom to the editor canvas.
                    event.preventDefault();
                    const factor = event.deltaY < 0 ? 1.08 : 0.92;
                    setStageView((current) => {
                      const nextScale = Math.max(0.25, Math.min(4, current.scale * factor));
                      return { ...current, scale: nextScale };
                    });
                    setEditorViewportZoom((current) => ({ requestId: current.requestId + 1, factor }));
                  }}
                  onPointerDown={(event) => {
                    if (event.button !== 0) {
                      return;
                    }
                    (event.currentTarget as HTMLButtonElement).setPointerCapture(event.pointerId);
                    stageDragRef.current = {
                      pointerId: event.pointerId,
                      lastClientX: event.clientX,
                      lastClientY: event.clientY,
                      moved: false,
                    };
                    setIsStageDragging(true);
                  }}
                  onPointerMove={(event) => {
                    const drag = stageDragRef.current;
                    if (!drag || drag.pointerId !== event.pointerId) {
                      return;
                    }

                    const dx = event.clientX - drag.lastClientX;
                    const dy = event.clientY - drag.lastClientY;
                    drag.lastClientX = event.clientX;
                    drag.lastClientY = event.clientY;
                    if (!drag.moved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
                      drag.moved = true;
                    }
                    if (!dx && !dy) {
                      return;
                    }

                    setStageView((current) => {
                      const limit = 2000;
                      return {
                        ...current,
                        x: Math.max(-limit, Math.min(limit, current.x + dx)),
                        y: Math.max(-limit, Math.min(limit, current.y + dy)),
                      };
                    });
                    setEditorViewportPan((current) => ({ requestId: current.requestId + 1, dx, dy }));
                  }}
                  onPointerUp={(event) => {
                    const drag = stageDragRef.current;
                    if (!drag || drag.pointerId !== event.pointerId) {
                      return;
                    }
                    (event.currentTarget as HTMLButtonElement).releasePointerCapture(event.pointerId);
                    if (!drag.moved) {
                      stageDragRef.current = null;
                      setIsStageDragging(false);
                      return;
                    }
                    window.setTimeout(() => {
                      if (stageDragRef.current?.pointerId === event.pointerId) {
                        stageDragRef.current = null;
                        setIsStageDragging(false);
                      }
                    }, 0);
                  }}
                  onPointerCancel={(event) => {
                    const drag = stageDragRef.current;
                    if (!drag || drag.pointerId !== event.pointerId) {
                      return;
                    }
                    stageDragRef.current = null;
                    setIsStageDragging(false);
                  }}
                  className="block w-full overflow-hidden rounded-[20px] border border-[#dbc8b0] bg-[#faf8f3] text-left transition hover:border-orange-300"
                  style={{ touchAction: 'none', cursor: isStageDragging ? 'grabbing' : 'grab' }}
                >
                  <img
                    src={importPreviewImage}
                    alt="参考图预览"
                    className="block h-[180px] w-full object-contain sm:h-[220px]"
                    style={{
                      transform: `translate(${stageView.x}px, ${stageView.y}px) scale(${stageView.scale})`,
                      transformOrigin: 'center',
                    }}
                  />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={requestImportImage}
                  className="flex h-[180px] w-full items-center justify-center rounded-[20px] border-2 border-dashed border-[#dcc9ae] bg-[linear-gradient(180deg,#faf8f3_0%,#f6f0e6_100%)] text-sm font-black text-[#8d5a24] transition hover:border-orange-400 hover:bg-orange-50 sm:h-[220px]"
                >
                  导入参考图
                </button>
              )}

              <div className="mt-3 rounded-2xl border border-[#ece2d3] bg-[#fbf8f2] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[10px] font-bold tracking-[0.2em] text-gray-400">视图</div>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      {
                        mode: 'color',
                        label: '像素',
                        icon: (
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M4 4h6v6H4z" />
                            <path d="M14 4h6v6h-6z" />
                            <path d="M4 14h6v6H4z" />
                            <path d="M14 14h6v6h-6z" />
                          </svg>
                        ),
                      },
                      {
                        mode: 'number',
                        label: '标号',
                        icon: (
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M9 4L7 20" />
                            <path d="M17 4l-2 16" />
                            <path d="M4 9h18" />
                            <path d="M3 15h18" />
                          </svg>
                        ),
                      },
                      {
                        mode: 'overlay',
                        label: '临摹',
                        icon: (
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M6 7a2 2 0 012-2h8a2 2 0 012 2v10a2 2 0 01-2 2H8a2 2 0 01-2-2z" />
                            <path d="M8 3h8a2 2 0 012 2v1" />
                          </svg>
                        ),
                      },
                    ] as Array<{ mode: EditorViewMode; label: string; icon: ReactNode }>).map(({ mode, label, icon }) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setViewMode(mode)}
                        aria-label={label}
                        title={label}
                        className={`group relative inline-flex h-9 w-9 items-center justify-center rounded-xl transition ${
                          viewMode === mode ? 'bg-teal-600 text-white' : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {icon}
                        <span className="pointer-events-none absolute left-1/2 top-full z-40 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-1.5 py-1 text-[10px] font-semibold text-white opacity-0 shadow transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                          {label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                {viewMode === 'overlay' && overlayImage && (
                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between text-[11px] font-bold text-gray-500">
                      <span>底图透明度</span>
                      <span className="text-teal-700">{Math.round(overlayOpacity * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="1"
                      step="0.05"
                      value={overlayOpacity}
                      onChange={(e) => setOverlayOpacity(Number.parseFloat(e.target.value))}
                      className="w-full accent-teal-600"
                    />
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setSidebarTab('palette')}
                className="mt-3 w-full rounded-2xl border border-[#efe3cf] bg-[#fbf8f2] p-3 text-left transition hover:border-orange-300"
              >
                <div className="text-[10px] font-bold tracking-[0.2em] text-gray-400">当前颜色</div>
                <div
                  className="mt-2 flex items-center gap-3 rounded-xl border border-white/80 px-3 py-2"
                  style={{ backgroundColor: selectedColor?.hex ?? '#f3ede1' }}
                >
                  <div
                    className="h-8 w-8 rounded-lg border border-white"
                    style={{ backgroundColor: selectedColor?.hex ?? '#f3ede1' }}
                  />
                  <div className="min-w-0 flex-1" style={{ color: getColorTextColor(selectedColor) }}>
                    <div className="truncate text-xs font-black">{selectedColor?.name ?? '未选择'}</div>
                    <div className="truncate text-[11px] font-bold opacity-80">{selectedColor?.hex ?? '点击从色卡里选'}</div>
                  </div>
                  <span className="rounded-full bg-white/80 px-2 py-1 text-[10px] font-black text-gray-700">色卡</span>
                </div>
              </button>

              <div className="mt-3 rounded-2xl border border-[#efe3cf] bg-[#fbf8f2] px-3 py-2.5">
                <div className="text-[10px] font-bold tracking-[0.2em] text-gray-400">信息</div>
                <div className="mt-2 space-y-1.5 text-[11px] leading-5 text-gray-600">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">参考图</span>
                    <span className="truncate font-semibold text-gray-800">{importStatus.hasReference ? (importStatus.sourceName ?? '已载入') : '未载入'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span>拼豆数量</span>
                    <span className="font-semibold text-gray-800">{stats.totalBeans}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span>颜色数</span>
                    <span className="font-semibold text-gray-800">{stats.uniqueColors}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span>生成策略</span>
                    <span className="truncate font-semibold text-gray-800">{currentRenderLabel}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="order-1 min-h-[52vh] overflow-hidden sm:min-h-[60vh] lg:order-none lg:h-full lg:min-h-0">
                <div
                  className="h-full w-full"
                  onClick={(event) => {
                    if (event.target === event.currentTarget && selectionPoints.length > 0 && (drawMode === 'select' || drawMode === 'move' || drawMode === 'select-color')) {
                      setSelectionPoints([]);
                      setDrawMode('paint');
                    }
                  }}
                >
                <GridEditor
                  gridState={composedGridState}
                  hoverLayerPreview={hoveredLayerPreview}
                  selectionPoints={selectionPoints}
                  viewMode={viewMode}
                  overlayImage={overlayImage}
                  overlayOpacity={overlayOpacity}
                  previewPoints={previewPoints}
                  previewColor={previewColor}
                  drawMode={drawMode}
                  externalViewportPan={editorViewportPan}
                  externalViewportZoom={editorViewportZoom}
                  colorAdjustment={{
                    enabled: importColorControlState.hasImage,
                    targetColorMode: importColorControlState.targetColorMode,
                    recommendedTargetColors: importColorControlState.recommendedTargetColors,
                    selectedTargetColors: importColorControlState.selectedTargetColors,
                  minTargetColors: importColorControlState.minTargetColors,
                  maxTargetColors: importColorControlState.maxTargetColors,
                  onApplyAuto: () => importColorActionsRef.current?.applyAutoTargetColors(),
                  onApplyManual: (value) => importColorActionsRef.current?.applyManualTargetColors(value),
                }}
                onDrawModeChange={setDrawMode}
                onCellMouseDown={handleEditorMouseDown}
                onCellMouseEnter={handleMouseEnter}
                onGlobalMouseUp={handleMouseUp}
                onSelectColor={(color) => {
                  setSelectedColor(color);
                  setDrawMode('paint');
                }}
              />
              </div>
            </div>
          </div>
        </section>

        <aside className="order-2 flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-[#e8dcc8] bg-white/97 lg:order-none lg:h-full">
          <div className="grid grid-cols-2 gap-2 border-b border-[#efe3d2] p-3">
            <button
              type="button"
              onClick={() => setSidebarTab('edit')}
              className={`rounded-2xl px-3 py-2 text-sm font-black transition ${sidebarTab === 'edit' ? 'bg-orange-500 text-white' : 'bg-[#faf6ef] text-gray-700'}`}
            >
              编辑
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab('palette')}
              className={`rounded-2xl px-3 py-2 text-sm font-black transition ${sidebarTab === 'palette' ? 'bg-orange-500 text-white' : 'bg-[#faf6ef] text-gray-700'}`}
            >
              色卡
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 custom-scrollbar">
            {sidebarTab === 'edit' ? (
              <div className="space-y-3">
                <div className="rounded-2xl border border-gray-100 bg-[#faf8f3] p-3">
                  <div className="mb-3 rounded-2xl bg-white p-2.5">
                    <div className="mb-1.5 flex items-center justify-between">
                      <div>
                        <div className="text-[10px] font-bold tracking-[0.2em] text-gray-400">图层</div>
                        <div className="mt-0.5 text-xs font-black text-gray-800">图层管理</div>
                      </div>
                      <button
                        type="button"
                        onClick={addLayer}
                        aria-label="新增图层"
                        title="新增图层"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-teal-200 bg-teal-50 text-teal-700 transition hover:bg-teal-100"
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 5v14" />
                          <path d="M5 12h14" />
                        </svg>
                      </button>
                    </div>

                    <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1 custom-scrollbar">
                      {[...gridState.layers].reverse().map((layer) => {
                        const isActive = layer.id === gridState.activeLayerId;
                        return (
                          <div
                            key={layer.id}
                            onMouseEnter={() => setHoveredLayerId(layer.id)}
                            onMouseLeave={() => setHoveredLayerId((current) => (current === layer.id ? null : current))}
                            className={`flex items-center gap-1.5 rounded-lg border px-1.5 py-1.5 transition ${
                              isActive ? 'border-orange-300 bg-orange-50/70' : 'border-gray-200 bg-white'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => setActiveLayer(layer.id)}
                              className="min-w-0 flex-1 truncate text-left text-[11px] font-bold text-gray-700"
                              title={layer.name}
                            >
                              {layer.name}
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleLayerVisibility(layer.id)}
                              aria-label={layer.visible ? '隐藏图层' : '显示图层'}
                              title={layer.visible ? '隐藏图层' : '显示图层'}
                              className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition ${
                                layer.visible
                                  ? 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                                  : 'bg-gray-900 text-white'
                              }`}
                            >
                              {layer.visible ? (
                                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
                                  <circle cx="12" cy="12" r="3" />
                                </svg>
                              ) : (
                                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M3 3l18 18" />
                                  <path d="M10.6 10.6a2 2 0 102.8 2.8" />
                                  <path d="M9.9 5.1A10.8 10.8 0 0112 5c6.5 0 10 7 10 7a18 18 0 01-3.1 3.8" />
                                  <path d="M6.1 6.1A18.2 18.2 0 002 12s3.5 7 10 7c1.4 0 2.7-.3 3.9-.8" />
                                </svg>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const next = window.prompt('输入图层名称', layer.name);
                                if (next !== null) {
                                  renameLayer(layer.id, next);
                                }
                              }}
                              aria-label="重命名图层"
                              title="重命名图层"
                              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50"
                            >
                              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M4 20l4-1 10-10-3-3L5 16l-1 4z" />
                                <path d="M13 7l3 3" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              disabled={gridState.layers.length <= 1}
                              onClick={() => removeLayer(layer.id)}
                              aria-label="删除图层"
                              title="删除图层"
                              className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition ${
                                gridState.layers.length <= 1
                                  ? 'cursor-not-allowed bg-gray-100 text-gray-300'
                                  : 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                              }`}
                            >
                              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M3 6h18" />
                                <path d="M8 6V4h8v2" />
                                <path d="M6 6l1 14h10l1-14" />
                                <path d="M10 10v7" />
                                <path d="M14 10v7" />
                              </svg>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    </div>

                    {drawMode === 'pick' && (
                      <div className="mb-3 rounded-2xl bg-white p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="text-[10px] font-bold tracking-[0.2em] text-gray-400">取色源</div>
                          {overlayImage && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setPickSource('current')}
                                className={`group relative inline-flex h-7 items-center justify-center rounded-xl px-2 transition ${
                                  pickSource === 'current'
                                    ? 'bg-teal-600 text-white'
                                    : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                                }`}
                                title="从当前画布颜色取色"
                              >
                                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <rect x="3" y="3" width="7" height="7" />
                                  <rect x="14" y="3" width="7" height="7" />
                                  <rect x="14" y="14" width="7" height="7" />
                                  <rect x="3" y="14" width="7" height="7" />
                                </svg>
                                <span className="pointer-events-none absolute left-1/2 top-full z-40 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-1.5 py-1 text-[10px] font-semibold text-white opacity-0 shadow transition-opacity group-hover:opacity-100">
                                  当前颜色
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setPickSource('overlay')}
                                className={`group relative inline-flex h-7 items-center justify-center rounded-xl px-2 transition ${
                                  pickSource === 'overlay'
                                    ? 'bg-teal-600 text-white'
                                    : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                                }`}
                                title="从参考图取色"
                              >
                                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M6 7a2 2 0 012-2h8a2 2 0 012 2v10a2 2 0 01-2 2H8a2 2 0 01-2-2z" />
                                  <path d="M8 3h8a2 2 0 012 2v1" />
                                </svg>
                                <span className="pointer-events-none absolute left-1/2 top-full z-40 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-1.5 py-1 text-[10px] font-semibold text-white opacity-0 shadow transition-opacity group-hover:opacity-100">
                                  参考底图
                                </span>
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="text-xs font-black text-gray-800">
                          {pickSource === 'current' ? '当前颜色' : '参考底图'}
                        </div>
                        {!overlayImage && (
                          <p className="mt-2 text-[11px] leading-5 text-gray-500">
                            导入参考图后可使用底图取色模式
                          </p>
                        )}
                      </div>
                    )}

                    <div className="mb-3 grid grid-cols-2 gap-2 rounded-2xl bg-white p-3">
                    <div>
                      <div className="text-[10px] font-bold tracking-[0.2em] text-gray-400">当前工具</div>
                      <div className="mt-1 text-sm font-black text-gray-800">{DRAW_MODE_LABELS[drawMode]}</div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[10px] font-bold tracking-[0.2em] text-gray-400">镜像模式</div>
                        <button
                          type="button"
                          onClick={() => {
                            setMirrorMode(mirrorMode === 'none' ? lastNonNoneMirrorModeRef.current : 'none');
                          }}
                          aria-pressed={mirrorMode !== 'none'}
                          className={`rounded-full px-2.5 py-1 text-[10px] font-black transition ${
                            mirrorMode === 'none'
                              ? 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                              : 'border border-[#8d5a24] bg-[#8d5a24] text-white hover:bg-[#7b4f21]'
                          }`}
                        >
                          {mirrorMode === 'none' ? '打开' : '关闭'}
                        </button>
                      </div>
                      <div className="mt-1 text-sm font-black text-gray-800">
                        {mirrorMode === 'none' ? '关闭' : `开启 · ${MIRROR_MODE_LABELS[mirrorMode]}`}
                      </div>
                      {mirrorMode !== 'none' && (
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          {([
                            {
                              mode: 'vertical',
                              label: '左右',
                              icon: (
                                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M12 4v16" />
                                  <path d="M4 12h6" />
                                  <path d="M20 12h-6" />
                                  <path d="M4 12l3-3" />
                                  <path d="M4 12l3 3" />
                                  <path d="M20 12l-3-3" />
                                  <path d="M20 12l-3 3" />
                                </svg>
                              ),
                            },
                            {
                              mode: 'horizontal',
                              label: '上下',
                              icon: (
                                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M4 12h16" />
                                  <path d="M12 4v6" />
                                  <path d="M12 20v-6" />
                                  <path d="M12 4l-3 3" />
                                  <path d="M12 4l3 3" />
                                  <path d="M12 20l-3-3" />
                                  <path d="M12 20l3-3" />
                                </svg>
                              ),
                            },
                            {
                              mode: 'quad',
                              label: '四向',
                              icon: (
                                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M12 3v18" />
                                  <path d="M3 12h18" />
                                  <path d="M12 3l-2 2" />
                                  <path d="M12 3l2 2" />
                                  <path d="M12 21l-2-2" />
                                  <path d="M12 21l2-2" />
                                  <path d="M3 12l2-2" />
                                  <path d="M3 12l2 2" />
                                  <path d="M21 12l-2-2" />
                                  <path d="M21 12l-2 2" />
                                </svg>
                              ),
                            },
                          ] as Array<{ mode: Exclude<MirrorMode, 'none'>; label: string; icon: ReactNode }>).map(({ mode, label, icon }) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => setMirrorMode(mode)}
                              title={label}
                              aria-label={label}
                              className={`group relative inline-flex h-7 items-center justify-center rounded-xl px-2 transition ${
                                mirrorMode === mode ? 'bg-[#8d5a24] text-white' : 'border border-gray-200 bg-white text-gray-700'
                              }`}
                            >
                              {icon}
                              <span className="pointer-events-none absolute left-1/2 top-full z-40 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-1.5 py-1 text-[10px] font-semibold text-white opacity-0 shadow transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                {label}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {drawMode === 'text' && (
                    <div className="mb-3 rounded-2xl bg-white p-3">
                      <div className="mb-1.5">
                        <div className="text-[10px] font-bold tracking-[0.2em] text-gray-400">文字内容</div>
                        <div className="mt-0.5 text-xs font-black text-gray-800">输入要绘制的文字</div>
                      </div>
                      <input
                        type="text"
                        placeholder="输入文字..."
                        value={textInputContent}
                        onChange={(e) => setTextInputContentValue(e.target.value)}
                        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm font-medium text-gray-800 placeholder:text-gray-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                      />
                      <p className="mt-2 text-[11px] leading-5 text-gray-500">
                        在画布上点击或拖拽来绘制文字
                      </p>
                    </div>
                  )}

                  <p className="mt-2 text-[11px] leading-5 text-gray-500">
                    主工具在画布底部；顶栏负责导入与撤销重做，适合连续修稿。
                  </p>
                </div>

                <ExportPanel gridState={composedGridState} compact />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-2xl border border-gray-100 bg-[#faf8f3] p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[10px] font-bold tracking-[0.2em] text-gray-400">色卡面板</div>
                      <div className="mt-1 text-sm font-black text-gray-800">当前豆子色卡</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsPaletteCollapsed((prev) => !prev)}
                      className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-bold text-gray-700 transition hover:bg-gray-50"
                    >
                      {isPaletteCollapsed ? '展开' : '折叠'}
                    </button>
                  </div>
                </div>

                {!isPaletteCollapsed && (
                  <ColorPalette
                    palette={gridState.palette}
                    selectedColor={selectedColor}
                    onSelectColor={handleSelectDrawingColor}
                    onPaletteLoad={handlePaletteLoad}
                    compact
                  />
                )}
              </div>
            )}
          </div>

          <div className="border-t border-[#efe3d2] bg-[#fbf7f0] px-3 py-2.5">
            <div className="rounded-2xl border border-[#e8dcc8] bg-white px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-bold tracking-[0.2em] text-gray-400">BRAND NOTE</div>
                  <div className="mt-0.5 text-xs font-black text-gray-800">{BRAND_NAME}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <a
                      href={BRAND_GITHUB_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] font-semibold text-teal-700 underline decoration-teal-200 underline-offset-2"
                      title="GitHub 仓库"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                      </svg>
                      <span>GitHub</span>
                    </a>
                    <span className="text-gray-300">|</span>
                    <a
                      href={BRAND_XIAOHONGSHU_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-600 underline decoration-rose-200 underline-offset-2"
                      title="小红书主页"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.766 7.82c.82 0 1.484.664 1.484 1.484V16.8c0 .82-.664 1.484-1.484 1.484H6.234c-.82 0-1.484-.664-1.484-1.484V9.304c0-.82.664-1.484 1.484-1.484h11.532z" />
                      </svg>
                      <span>{BRAND_XIAOHONGSHU_LABEL}</span>
                    </a>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="rounded-full bg-[#fff3e6] px-2 py-0.5 text-[10px] font-black text-[#c45a12]">{APP_VERSION}</span>
                  <button
                    type="button"
                    onClick={() => setIsAboutCardCollapsed((prev) => !prev)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50"
                    aria-label={isAboutCardCollapsed ? '展开品牌说明' : '收起品牌说明'}
                    title={isAboutCardCollapsed ? '展开' : '收起'}
                  >
                    <svg className={`h-3.5 w-3.5 transition ${isAboutCardCollapsed ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                </div>
              </div>
              {!isAboutCardCollapsed && (
                <>
                  <p className="mt-1.5 text-[11px] leading-5 text-gray-600">
          
                     <p>常用的抠图、配色、图层修整和导出清单整合在一个桌面工作区里</p>
                  </p>
            
                  <button
                    type="button"
                    onClick={() => setIsAboutModalOpen(true)}
                    className="mt-2.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-bold text-gray-700 transition hover:bg-gray-50"
                  >
                    查看完整说明
                  </button>
                </>
              )}
            </div>
          </div>
        </aside>
      </main>

      <div
        className={`fixed inset-0 z-40 p-3 transition md:p-5 ${
          isImportModalOpen ? 'pointer-events-auto bg-[#2b241d]/42 backdrop-blur-[2px]' : 'pointer-events-none bg-transparent'
        }`}
        onClick={() => setIsImportModalOpen(false)}
      >
          <div className="mx-auto flex h-full max-w-[1080px] items-center justify-center">
            <div
              className={`flex h-full max-h-[92vh] w-full flex-col overflow-hidden rounded-[24px] border border-[#eadfd0] bg-[#fffaf2] transition md:max-h-[86vh] md:rounded-[30px] ${
                isImportModalOpen ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
              }`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex flex-col gap-3 border-b border-[#efe3d2] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div>
                  <h2 className="text-lg font-black text-gray-900">导入图片，生成 {BRAND_SHORT_NAME} 的图纸稿</h2>
                  <p className="text-xs text-gray-500">在这里完成裁切、缩放和去底，再送进主编辑区调颜色与微调</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsImportModalOpen(false)}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-bold text-gray-700 transition hover:bg-gray-50 sm:w-auto"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 6l12 12" />
                    <path d="M18 6L6 18" />
                  </svg>
                  关闭
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-4 custom-scrollbar">
                <ImageProcessor
                  palette={gridState.palette?.colors ?? null}
                  targetConfig={gridState.config}
                  onGridLoaded={handleGridLoaded}
                  variant="modal"
                  initialImageFile={pendingImportFile}
                  initialPreviewImageUrl={pendingImportFile ? null : importPreviewImage}
                  onRequestImageFile={requestImportImage}
                  enableExperimentalModes
                  defaultAlgorithmMode="legacy-clean"
                  onProcessed={() => setIsImportModalOpen(false)}
                  onPreviewChange={setImportPreviewImage}
                  onColorControlsChange={handleImportColorControlsChange}
                  onStatusChange={setImportStatus}
                />
              </div>
            </div>
        </div>
      </div>

      <div
        className={`fixed inset-0 z-50 p-3 transition md:p-5 ${
          isJsonPasteModalOpen ? 'pointer-events-auto bg-[#2b241d]/42 backdrop-blur-[2px]' : 'pointer-events-none bg-transparent'
        }`}
        onClick={() => setIsJsonPasteModalOpen(false)}
      >
        <div className="mx-auto flex h-full max-w-[600px] items-center justify-center">
          <div
            className={`w-full overflow-hidden rounded-[24px] border border-[#eadfd0] bg-[#fffaf2] transition md:rounded-[30px] ${
              isJsonPasteModalOpen ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
            }`}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="flex flex-col gap-3 border-b border-[#efe3d2] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <h2 className="text-lg font-black text-gray-900">导入 JSON</h2>
                <p className="text-xs text-gray-500">上传文件或粘贴文本，支持工程导出格式。</p>
              </div>
              <button
                type="button"
                onClick={() => setIsJsonPasteModalOpen(false)}
                className="rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-bold text-gray-700 transition hover:bg-gray-50"
              >
                关闭
              </button>
            </div>

            <div className="space-y-3 p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <label className="flex-1 cursor-pointer">
                  <input
                    ref={importJsonInputRef}
                    type="file"
                    accept=".json,application/json"
                    onChange={handleImportJsonSelected}
                    className="hidden"
                  />
                  <div className="flex h-16 items-center justify-center rounded-2xl border-2 border-dashed border-[#dccfbf] bg-white text-center text-sm font-bold text-gray-600 transition hover:border-teal-300 hover:bg-teal-50">
                    <div className="flex items-center gap-2">
                      <svg className="h-5 w-5 text-teal-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                        <polyline points="17,8 12,3 7,8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                      <span>选择 JSON 文件</span>
                    </div>
                  </div>
                </label>
                <div className="flex items-center gap-1 text-gray-400">
                  <span className="text-xs font-bold">或</span>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-gray-700">粘贴 JSON</label>
                <textarea
                  value={jsonImportDraft}
                  onChange={(event) => setJsonImportDraft(event.target.value)}
                  placeholder={`{\n  "width": 50,\n  "height": 50,\n  "points": [\n    { "x": 10, "y": 12, "hex": "#000000" }\n  ]\n}`}
                  className="h-[180px] w-full rounded-2xl border border-[#dccfbf] bg-white px-4 py-3 font-mono text-[12px] leading-6 text-gray-800 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[11px] leading-5 text-gray-500">
                  支持 <code className="rounded bg-gray-100 px-1 font-mono text-[10px]">#RRGGBB</code> 或 <code className="rounded bg-gray-100 px-1 font-mono text-[10px]">{"{ hex: '...' }"}</code> 格式
                </p>
                <button
                  type="button"
                  onClick={handleImportJsonText}
                  disabled={!jsonImportDraft.trim()}
                  className={`rounded-full px-4 py-2 text-xs font-bold transition ${
                    jsonImportDraft.trim()
                      ? 'border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100'
                      : 'cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-300'
                  }`}
                >
                  确认导入
                </button>
              </div>

              <div className="rounded-2xl border border-[#eadfd0] bg-[#fbf8f2] p-3">
                <div className="mb-2 flex items-center gap-2">
                  <svg className="h-4 w-4 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 16v-4" />
                    <path d="M12 8h.01" />
                  </svg>
                  <h3 className="text-xs font-black text-gray-800">AI 绘画提示词</h3>
                </div>
                <div className="space-y-2 text-[11px] leading-5 text-gray-600">
                  <p>
                    使用以下模板让 AI 生成兼容的 JSON 格式：
                  </p>
                  <div className="rounded-xl border border-[#dccfbf] bg-white p-2.5 font-mono text-[10px] leading-5 text-gray-700">
                    <p className="mb-1 text-gray-500">复制提示词给 AI：</p>
                    <p className="text-slate-600">
                      "请生成一个拼豆图纸 JSON，包含 <span className="text-sky-700">width</span>（宽度）、<span className="text-sky-700">height</span>（高度）、<span className="text-sky-700">points</span>（颜色点数组，每项含 x、y、hex 坐标和颜色）"
                    </p>
                  </div>
                  <p className="mt-2 text-gray-500">
                    也可以让 AI 生成图片后，使用上方「导入图片」功能自动转换。
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className={`fixed inset-0 z-50 p-3 transition md:p-5 ${
          isAboutModalOpen ? 'pointer-events-auto bg-[#2b241d]/42 backdrop-blur-[2px]' : 'pointer-events-none bg-transparent'
        }`}
        onClick={() => setIsAboutModalOpen(false)}
      >
        <div className="mx-auto flex h-full max-w-[920px] items-center justify-center">
          <div
            className={`w-full max-w-5xl overflow-hidden rounded-[24px] border border-[#eadfd0] bg-[#fffaf2] transition md:rounded-[30px] ${
              isAboutModalOpen ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
            }`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-col gap-3 border-b border-[#efe3d2] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <h2 className="text-lg font-black text-gray-900">关于 {BRAND_NAME}</h2>
                <p className="text-xs text-gray-500">完整功能说明与使用指南</p>
              </div>
              <button
                type="button"
                onClick={() => setIsAboutModalOpen(false)}
                className="rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-bold text-gray-700 transition hover:bg-gray-50"
              >
                关闭
              </button>
            </div>

            <div className="max-h-[65vh] overflow-y-auto p-4 sm:p-5 custom-scrollbar">
              <div className="mb-4 rounded-2xl border border-[#eadfd0] bg-gradient-to-br from-[#fbf8f2] to-white p-4">
                <h3 className="text-base font-black text-gray-800">🎨 完整工作流程</h3>
                <p className="mt-2 text-[13px] leading-6 text-gray-600">
                  从参考图到可开做的拼豆方案，一站式搞定：<br/>
                  <span className="font-semibold text-orange-700">导入图片</span> → <span className="font-semibold text-teal-700">智能抠图</span> → <span className="font-semibold text-sky-700">自动配色</span> → <span className="font-semibold text-emerald-700">精细修图</span> → <span className="font-semibold text-amber-700">导出清单</span>
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-[#eadfd0] bg-white p-3">
                  <h3 className="text-sm font-black text-gray-800">📥 导入与参考图</h3>
                  <ul className="mt-2 space-y-1.5 text-[12px] leading-5 text-gray-600">
                    <li><span className="font-semibold text-orange-600">导入图片：</span>支持自由裁切、自动去白底、智能抠图</li>
                    <li><span className="font-semibold text-orange-600">导入 JSON：</span>兼容工程导出格式，支持 AI 生成</li>
                    <li><span className="font-semibold text-orange-600">主体适配：</span>一键将裁切后的图片适配到画布</li>
                  </ul>
                </div>

                <div className="rounded-2xl border border-[#eadfd0] bg-white p-3">
                  <h3 className="text-sm font-black text-gray-800">✂️ 智能抠图工具</h3>
                  <ul className="mt-2 space-y-1.5 text-[12px] leading-5 text-gray-600">
                    <li><span className="font-semibold text-teal-600">自动识别：</span>快速抠出主体，按颜色与连通区域清理背景</li>
                    <li><span className="font-semibold text-teal-600">恢复笔刷：</span>在被删掉的区域涂抹，按源图颜色恢复内容</li>
                    <li><span className="font-semibold text-teal-600">删除笔刷：</span>在背景区域涂抹，自动清理相近颜色</li>
                    <li><span className="font-semibold text-teal-600">撤销操作：</span>随时回退上一步抠图状态</li>
                  </ul>
                </div>

                <div className="rounded-2xl border border-[#eadfd0] bg-white p-3">
                  <h3 className="text-sm font-black text-gray-800">🎨 配色与生成</h3>
                  <ul className="mt-2 space-y-1.5 text-[12px] leading-5 text-gray-600">
                    <li><span className="font-semibold text-sky-600">自动配色：</span>智能推荐最佳颜色数量，一键应用</li>
                    <li><span className="font-semibold text-sky-600">手动调节：</span>4-12 色自由调整，即时预览效果</li>
                    <li><span className="font-semibold text-sky-600">算法模式：</span>主体清理优先、轮廓锁定、黑线稿填色等</li>
                    <li><span className="font-semibold text-sky-600">工作分辨率：</span>多尺度区域合并，再投影到目标画布</li>
                  </ul>
                </div>

                <div className="rounded-2xl border border-[#eadfd0] bg-white p-3">
                  <h3 className="text-sm font-black text-gray-800">🖌️ 画布编辑</h3>
                  <ul className="mt-2 space-y-1.5 text-[12px] leading-5 text-gray-600">
                    <li><span className="font-semibold text-emerald-600">画笔工具：</span>选择豆子颜色在画布上绘制</li>
                    <li><span className="font-semibold text-emerald-600">油漆桶：</span>填充连通区域为当前颜色</li>
                    <li><span className="font-semibold text-emerald-600">取色器：</span>Alt+ 左键或右键单击像素取色</li>
                    <li><span className="font-semibold text-emerald-600">橡皮擦：</span>清除绘制的豆子</li>
                  </ul>
                </div>

                <div className="rounded-2xl border border-[#eadfd0] bg-white p-3">
                  <h3 className="text-sm font-black text-gray-800">⬜ 选择与移动</h3>
                  <ul className="mt-2 space-y-1.5 text-[12px] leading-5 text-gray-600">
                    <li><span className="font-semibold text-indigo-600">框选工具：</span>框选区域，支持移动和内容搬运</li>
                    <li><span className="font-semibold text-indigo-600">同色选取：</span>一键选中所有相同颜色的豆子</li>
                    <li><span className="font-semibold text-indigo-600">移动选区：</span>搬移选中的内容到新位置</li>
                    <li><span className="font-semibold text-indigo-600">ESC 取消：</span>按 ESC 或点击空白处取消选区</li>
                  </ul>
                </div>

                <div className="rounded-2xl border border-[#eadfd0] bg-white p-3">
                  <h3 className="text-sm font-black text-gray-800">📐 形状工具</h3>
                  <ul className="mt-2 space-y-1.5 text-[12px] leading-5 text-gray-600">
                    <li><span className="font-semibold text-violet-600">直线：</span>绘制两点之间的直线</li>
                    <li><span className="font-semibold text-violet-600">矩形填充：</span>绘制并填充矩形区域</li>
                    <li><span className="font-semibold text-violet-600">圆形填充：</span>绘制并填充椭圆形</li>
                    <li><span className="font-semibold text-violet-600">三角形填充：</span>绘制并填充三角形</li>
                    <li><span className="font-semibold text-violet-600">文字输入：</span>在画布上输入文字</li>
                  </ul>
                </div>

                <div className="rounded-2xl border border-[#eadfd0] bg-white p-3">
                  <h3 className="text-sm font-black text-gray-800">🪞 镜像与视图</h3>
                  <ul className="mt-2 space-y-1.5 text-[12px] leading-5 text-gray-600">
                    <li><span className="font-semibold text-amber-600">镜像模式：</span>左右 / 上下 / 四向对称绘制</li>
                    <li><span className="font-semibold text-amber-600">三种视图：</span>像素视图、标号视图、临摹视图</li>
                    <li><span className="font-semibold text-amber-600">参考底图：</span>导入半透明参考图辅助绘制</li>
                    <li><span className="font-semibold text-amber-600">图层系统：</span>多图层管理，支持可见性切换</li>
                  </ul>
                </div>

                <div className="rounded-2xl border border-[#eadfd0] bg-white p-3">
                  <h3 className="text-sm font-black text-gray-800">📤 导出与分享</h3>
                  <ul className="mt-2 space-y-1.5 text-[12px] leading-5 text-gray-600">
                    <li><span className="font-semibold text-rose-600">颜色统计：</span>自动计算各颜色豆子数量</li>
                    <li><span className="font-semibold text-rose-600">工程文件：</span>保存完整编辑状态，方便后续修改</li>
                    <li><span className="font-semibold text-rose-600">图纸预览：</span>导出带标号/纯色的图纸图片</li>
                    <li><span className="font-semibold text-rose-600">清单整合：</span>减少备料和返工时间</li>
                  </ul>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-[#eadfd0] bg-[#fbf8f2] p-3">
                <h3 className="text-sm font-black text-gray-800">⌨️ 常用快捷键</h3>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div className="text-[12px] leading-5 text-gray-600">
                    <span className="font-semibold">撤销/重做：</span>Ctrl/⌘+Z / Shift+Ctrl/⌘+Z
                  </div>
                  <div className="text-[12px] leading-5 text-gray-600">
                    <span className="font-semibold">平移视图：</span>双指滚动 / 右键拖拽 / Space+ 拖拽
                  </div>
                  <div className="text-[12px] leading-5 text-gray-600">
                    <span className="font-semibold">缩放视图：</span>Ctrl/⌘+ 滚轮 / 双指捏合 / 画布 +/-
                  </div>
                  <div className="text-[12px] leading-5 text-gray-600">
                    <span className="font-semibold">快速取色：</span>Alt+ 左键 或 右键单击
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-[#eadfd0] bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-black text-gray-800">📦 品牌与版本</h3>
                    <p className="mt-1 text-[12px] text-gray-600">{BRAND_NAME} 由 {BRAND_SHORT_NAME} 命名维护，当前版本 {APP_VERSION}，专注桌面端拼豆图纸制作流程。</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px]">
                      <span className="text-gray-600">
                        GitHub：
                        <a
                          href={BRAND_GITHUB_URL}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-1 font-semibold text-teal-700 underline decoration-teal-200 underline-offset-2"
                        >
                          lx419394005-cloud/pingdou
                        </a>
                      </span>
                      <span className="text-gray-300">|</span>
                      <span className="text-gray-600">
                        小红书：
                        <a
                          href={BRAND_XIAOHONGSHU_URL}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-1 font-semibold text-rose-600 underline decoration-rose-200 underline-offset-2"
                        >
                          {BRAND_XIAOHONGSHU_LABEL}
                        </a>
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsAboutModalOpen(false)}
                    className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-[11px] font-bold text-orange-700 transition hover:bg-orange-100"
                  >
                    开始使用
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <input
        ref={importFileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImportFileSelected}
        className="hidden"
      />
    </div>
  );
}

export default App;
