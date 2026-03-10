import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { BRAND_DESCRIPTION, BRAND_GITHUB_URL, BRAND_NAME, BRAND_SHORT_NAME, BRAND_TAGLINE } from './config/brand';

const COLOR_DRIVEN_TOOLS = new Set<DrawMode>(['paint', 'fill', 'line', 'rectangle', 'ellipse', 'triangle']);
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
};
const MIRROR_MODE_LABELS: Record<MirrorMode, string> = {
  none: '关闭',
  vertical: '左右',
  horizontal: '上下',
  quad: '四向',
};
const APP_VERSION = 'v0.2.0';

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
  } = useGridState();

  const [viewMode, setViewMode] = useState<EditorViewMode>('color');
  const [overlayOpacity, setOverlayOpacity] = useState(0.55);
  const [overlayImage, setOverlayImage] = useState<string | null>(null);
  const [importPreviewImage, setImportPreviewImage] = useState<string | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
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
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const overlaySamplerRef = useRef<{
    src: string;
    width: number;
    height: number;
    data: Uint8ClampedArray;
  } | null>(null);
  const [importStatus, setImportStatus] = useState<{
    sourceName: string | null;
    algorithmMode: AlgorithmMode;
    hasReference: boolean;
    workingResolution: number;
  }>({
    sourceName: null,
    algorithmMode: 'legacy-clean',
    hasReference: false,
    workingResolution: 120,
  });

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
    if (!isImportModalOpen && !isExportModalOpen && !isAboutModalOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsImportModalOpen(false);
        setIsExportModalOpen(false);
        setIsAboutModalOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAboutModalOpen, isExportModalOpen, isImportModalOpen]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }

      const tag = target.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || target.isContentEditable;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') {
        return;
      }

      if (isEditableTarget(event.target)) {
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
  }, [canRedo, canUndo, redo, undo]);

  const handlePaletteLoad = (palette: { id: string; name: string; brand: string; colors: { name: string; hex: string; rgb: { r: number; g: number; b: number } }[] }) => {
    setPalette(palette);
  };

  const handleSelectDrawingColor = (color: Color) => {
    setSelectedColor(color);
    if (!COLOR_DRIVEN_TOOLS.has(drawMode)) {
      setDrawMode('paint');
    }
  };

  const handleGridLoaded = (
    cells: ({ name: string; hex: string; rgb: { r: number; g: number; b: number } } | null)[][],
    width: number,
    height: number,
    nextOverlayImage: string | null,
  ) => {
    loadGridData(cells, { width, height });
    setOverlayImage(nextOverlayImage);
    setViewMode('overlay');
    setIsImportModalOpen(false);
  };

  const requestImportImage = () => {
    importFileInputRef.current?.click();
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
    if (drawMode !== 'pick' || viewMode !== 'overlay' || !overlayImage || paletteColors.length === 0) {
      handleMouseDown(x, y);
      return;
    }

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
      const nearest = findNearestPaletteColor(rgb, paletteColors);
      if (!nearest) {
        handleMouseDown(x, y);
        return;
      }

      setSelectedColor(nearest);
      setDrawMode('paint');
    })();
  };

  const currentRenderLabel = importStatus.algorithmMode === 'legacy-nearest' ? '最近色直出' : '主体清理优先';
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
    <div className="h-screen overflow-hidden bg-[radial-gradient(circle_at_top,#fdf8ee_0%,#f2e8d8_42%,#ecdfcd_100%)] text-gray-800">
      <header className="sticky top-0 z-20 border-b border-[#e8dbc8] bg-white/94 backdrop-blur">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-[#9a4a16] bg-[#f08a34] text-white shadow-[0_10px_24px_rgba(212,96,29,0.18)]">
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
            <div>
              <h1 className="text-[25px] font-black tracking-tight text-gray-900">{BRAND_NAME}</h1>
              <p className="text-xs font-medium text-gray-500">{BRAND_DESCRIPTION}</p>
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
                  className="truncate text-left"
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

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={requestImportImage}
              className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-[11px] font-bold text-orange-700 transition hover:bg-orange-100"
            >
              导入图片
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
      </header>

      <main className="grid h-[calc(100vh-5.8rem)] grid-cols-[minmax(0,1fr)_336px] gap-3 px-3 py-3">
        <section className="flex min-h-0 min-w-0 flex-col gap-3">
          <div className="grid h-full min-h-0 grid-cols-[240px_minmax(0,1fr)] gap-3">
            <div className="rounded-[26px] border border-[#e8dcc8] bg-white/96 p-3">
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
                  onClick={() => setIsImportModalOpen(true)}
                  className="block w-full overflow-hidden rounded-[20px] border border-[#dbc8b0] bg-[#faf8f3] text-left transition hover:border-orange-300"
                >
                  <img
                    src={importPreviewImage}
                    alt="参考图预览"
                    className="block h-[220px] w-full object-contain"
                  />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={requestImportImage}
                  className="flex h-[220px] w-full items-center justify-center rounded-[20px] border-2 border-dashed border-[#dcc9ae] bg-[linear-gradient(180deg,#faf8f3_0%,#f6f0e6_100%)] text-sm font-black text-[#8d5a24] transition hover:border-orange-400 hover:bg-orange-50"
                >
                  导入参考图
                </button>
              )}

              <div className="mt-3 rounded-2xl border border-[#ece2d3] bg-[#fbf8f2] p-3">
                <div className="mb-2 text-[10px] font-bold tracking-[0.2em] text-gray-400">当前模式</div>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ['color', '像素'],
                    ['number', '标号'],
                    ['overlay', '临摹'],
                  ] as Array<[EditorViewMode, string]>).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setViewMode(mode)}
                      className={`rounded-xl px-2 py-2 text-xs font-bold transition ${
                        viewMode === mode ? 'bg-teal-600 text-white' : 'border border-gray-200 bg-white text-gray-700'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
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

            <div className="h-full min-h-0 overflow-hidden">
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
        </section>

        <aside className="flex h-full flex-col overflow-hidden rounded-[28px] border border-[#e8dcc8] bg-white/97">
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

                  <div className="mb-3 grid grid-cols-2 gap-2 rounded-2xl bg-white p-3">
                    <div>
                      <div className="text-[10px] font-bold tracking-[0.2em] text-gray-400">当前工具</div>
                      <div className="mt-1 text-sm font-black text-gray-800">{DRAW_MODE_LABELS[drawMode]}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold tracking-[0.2em] text-gray-400">镜像模式</div>
                      <div className="mt-1 text-sm font-black text-gray-800">{MIRROR_MODE_LABELS[mirrorMode]}</div>
                    </div>
                  </div>
                  <div className="mb-3 rounded-2xl bg-white p-3">
                    <div className="mb-2 text-[10px] font-bold tracking-[0.2em] text-gray-400">镜像方向</div>
                    <div className="grid grid-cols-4 gap-2">
                      {([
                        {
                          mode: 'none',
                          label: '关闭',
                          icon: (
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M5 5l14 14" />
                              <path d="M19 5L5 19" />
                            </svg>
                          ),
                        },
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
                      ] as Array<{ mode: MirrorMode; label: string; icon: ReactNode }>).map(({ mode, label, icon }) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setMirrorMode(mode)}
                          title={label}
                          aria-label={label}
                          className={`group relative inline-flex h-8 items-center justify-center rounded-xl px-2 transition ${
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
                  </div>
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
                <div>
                  <div className="text-[10px] font-bold tracking-[0.2em] text-gray-400">BRAND NOTE</div>
                  <div className="mt-0.5 text-xs font-black text-gray-800">{BRAND_NAME}</div>
                  <a
                    href={BRAND_GITHUB_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block text-[10px] font-semibold text-teal-700 underline decoration-teal-200 underline-offset-2"
                  >
                    GitHub: lx419394005-cloud/pingdou
                  </a>
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
                    {BRAND_TAGLINE}。{BRAND_SHORT_NAME}把常用的抠图、配色、图层修整和导出清单整合在一个桌面工作区里。
                  </p>
                  <p className="mt-2 text-[11px] leading-5 text-gray-500">
                    仓库地址：
                    <a
                      href={BRAND_GITHUB_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-1 font-semibold text-teal-700 underline decoration-teal-200 underline-offset-2"
                    >
                      {BRAND_GITHUB_URL}
                    </a>
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsAboutModalOpen(true)}
                    className="mt-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] font-bold text-gray-700 transition hover:bg-gray-50"
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
              className={`flex h-full max-h-[86vh] w-full flex-col overflow-hidden rounded-[30px] border border-[#eadfd0] bg-[#fffaf2] transition ${
                isImportModalOpen ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
              }`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-[#efe3d2] px-5 py-3.5">
                <div>
                  <h2 className="text-lg font-black text-gray-900">导入图片，生成 {BRAND_SHORT_NAME} 的图纸稿</h2>
                  <p className="text-xs text-gray-500">在这里完成裁切、缩放、去白底与颜色设置，再送进主编辑区微调</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={requestImportImage}
                    className="rounded-full border border-orange-200 bg-orange-50 px-3.5 py-1.5 text-xs font-bold text-orange-700 transition hover:bg-orange-100"
                  >
                    更换图片
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsImportModalOpen(false)}
                    className="rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-bold text-gray-700 transition hover:bg-gray-50"
                  >
                    关闭
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-4 custom-scrollbar">
                <ImageProcessor
                  palette={gridState.palette?.colors ?? null}
                  targetConfig={gridState.config}
                  onGridLoaded={handleGridLoaded}
                  variant="modal"
                  initialImageFile={pendingImportFile}
                  onRequestImageFile={requestImportImage}
                  defaultAlgorithmMode="legacy-clean"
                  onProcessed={() => setIsImportModalOpen(false)}
                  onPreviewChange={setImportPreviewImage}
                  onStatusChange={setImportStatus}
                />
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
            className={`w-full max-w-3xl overflow-hidden rounded-[30px] border border-[#eadfd0] bg-[#fffaf2] transition ${
              isAboutModalOpen ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
            }`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-[#efe3d2] px-5 py-4">
              <div>
                <h2 className="text-lg font-black text-gray-900">关于 {BRAND_NAME}</h2>
                <p className="text-xs text-gray-500">{BRAND_TAGLINE}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsAboutModalOpen(false)}
                className="rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-bold text-gray-700 transition hover:bg-gray-50"
              >
                关闭
              </button>
            </div>

            <div className="grid gap-3 p-5 md:grid-cols-2">
              <div className="rounded-2xl border border-[#eadfd0] bg-white p-3">
                <h3 className="text-sm font-black text-gray-800">这套工具负责什么</h3>
                <ul className="mt-2 space-y-1.5 text-[12px] leading-5 text-gray-600">
                  <li>把参考图整理成适合落地制作的拼豆图纸，不必在多个工具之间反复切换。</li>
                  <li>保留像素、标号、临摹三种视图，方便从排版检查切到实际制作视角。</li>
                  <li>提供多图层修稿、框选搬移、镜像绘制，适合角色图和对称图案。</li>
                  <li>一并导出颜色统计、工程文件与图纸预览，减少备料和返工。</li>
                </ul>
              </div>

              <div className="rounded-2xl border border-[#eadfd0] bg-white p-3">
                <h3 className="text-sm font-black text-gray-800">常用快捷操作</h3>
                <ul className="mt-2 space-y-1.5 text-[12px] leading-5 text-gray-600">
                  <li>撤销：Ctrl/⌘ + Z，重做：Shift + Ctrl/⌘ + Z</li>
                  <li>平移：双指滚动 / 右键拖拽 / Space + 拖拽</li>
                  <li>缩放：使用画布右下角 + / - 控件</li>
                  <li>取色：Alt + 左键 或 右键单击像素</li>
                </ul>
              </div>

              <div className="rounded-2xl border border-[#eadfd0] bg-white p-3 md:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-black text-gray-800">品牌与版本</h3>
                    <p className="mt-1 text-[12px] text-gray-600">{BRAND_NAME} 由 {BRAND_SHORT_NAME} 命名维护，当前版本 {APP_VERSION}，专注桌面端拼豆图纸制作流程。</p>
                    <p className="mt-2 text-[12px] text-gray-600">
                      GitHub：
                      <a
                        href={BRAND_GITHUB_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-1 font-semibold text-teal-700 underline decoration-teal-200 underline-offset-2"
                      >
                        lx419394005-cloud/pingdou
                      </a>
                    </p>
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
