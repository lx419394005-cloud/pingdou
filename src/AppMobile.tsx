import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GridEditor, type EditorViewMode } from './components/GridEditor';
import { ImageProcessor } from './components/ImageProcessor';
import { useGridState } from './hooks/useGridState';
import type { Color, GridCell } from './types';
import { BRAND_SHORT_NAME } from './config/brand';
import mardPalette from './data/colorCards/mard.json';
import type { ColorPalette } from './types';

// 工具配置 - 8 个工具，两排每排 4 个
const TOOLS = [
  { id: 'import', icon: 'image-plus', label: '导入', color: '#FF6B6B' },
  { id: 'paint', icon: 'paintbrush', label: '画笔', color: '#A78BFA' },
  { id: 'erase', icon: 'eraser', label: '橡皮', color: '#60A5FA' },
  { id: 'pick', icon: 'pipette', label: '取色', color: '#F472B6' },
  { id: 'line', icon: 'move-diagonal', label: '直线', color: '#FBBF24' },
  { id: 'rect', icon: 'square', label: '矩形', color: '#34D399' },
  { id: 'circle', icon: 'circle', label: '圆形', color: '#FB923C' },
  { id: 'select-color', icon: 'droplet', label: '选色', color: '#8B5CF6' },
];

export default function AppMobile() {
  const {
    gridState,
    composedCells,
    selectPaletteColor,
    drawMode,
    setDrawMode,
    setPalette,
    handleMouseDown,
    handleMouseEnter,
    handleMouseUp,
    previewPoints,
    previewColor,
    selectionPoints,
    loadGridData,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useGridState();

  // UI 状态
  // 视图模式切换
  const [viewMode, setViewMode] = useState<EditorViewMode>('color');
  const [overlayOpacity, setOverlayOpacity] = useState<number>(0.55);
  const [overlayImage, setOverlayImage] = useState<string | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isMenuModalOpen, setIsMenuModalOpen] = useState(false);
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [showQuickColors, setShowQuickColors] = useState(true); // 默认显示
  const [isEditingQuickColors, setIsEditingQuickColors] = useState(false);
  const [customQuickColors, setCustomQuickColors] = useState<number[]>([0, 1, 2, 3, 4, 5, 6, 7]);
  const [selectedEditSlot, setSelectedEditSlot] = useState<number | null>(null);
  const [projectName] = useState('我的新图纸');
  const [importPreviewImage, setImportPreviewImage] = useState<string | null>(null);

  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // 选择颜色模式
  const [selectedColorForFill, setSelectedColorForFill] = useState<Color | null>(null);

  // 导入相关状态
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);

  // 导出相关状态
  const [isExportPanelOpen, setIsExportPanelOpen] = useState(false);
  const [exportMode, setExportMode] = useState<'color' | 'number'>('number');
  const [exportPreviewDataUrl, setExportPreviewDataUrl] = useState<string | null>(null);
  const [isExportPreviewLoading, setIsExportPreviewLoading] = useState(false);

  const importColorActionsRef = useRef<{
    applyAutoTargetColors: () => void;
    applyManualTargetColors: (value: number) => void;
  } | null>(null);

  const handleImportFile = useCallback((file: File) => {
    setPendingImportFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      setImportPreviewImage(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleImportFile(file);
      }
    },
    [handleImportFile],
  );

  const handleAdjustOriginal = useCallback(() => {
    // 调整原图：重新打开导入弹窗
    setIsMenuModalOpen(false);
    setIsImportModalOpen(true);
  }, []);

  const generateExportPreview = useCallback((mode: 'color' | 'number') => {
    setIsExportPreviewLoading(true);
    setExportMode(mode);

    // 创建 canvas 导出图纸
    const canvas = document.createElement('canvas');
    const { width, height } = gridState.config;
    const CELL_SIZE = 24;
    const GUTTER = 40;
    const PADDING = 28;
    const HEADER_HEIGHT = 92;

    const canvasWidth = PADDING + GUTTER + (width * CELL_SIZE) + PADDING;
    const canvasHeight = HEADER_HEIGHT + GUTTER + (height * CELL_SIZE) + PADDING;

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setIsExportPreviewLoading(false);
      return;
    }

    // 背景
    ctx.fillStyle = '#fffdfa';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // 标题
    ctx.fillStyle = '#1f2937';
    ctx.font = '900 24px sans-serif';
    ctx.fillText(`${BRAND_SHORT_NAME}图纸`, PADDING, 38);
    ctx.font = '600 12px sans-serif';
    ctx.fillStyle = '#6b7280';
    ctx.fillText(`尺寸 ${width} × ${height}`, PADDING, 62);

    // 绘制网格
    const gridX = PADDING + GUTTER;
    const gridY = HEADER_HEIGHT + GUTTER;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = composedCells[y]?.[x];
        const cellX = gridX + (x * CELL_SIZE);
        const cellY = gridY + (y * CELL_SIZE);

        if (cell) {
          ctx.fillStyle = cell.hex;
          ctx.fillRect(cellX, cellY, CELL_SIZE, CELL_SIZE);

          if (mode === 'number' && cell) {
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 10px sans-serif';
            ctx.fillText(String(cell.name), cellX + CELL_SIZE / 2, cellY + CELL_SIZE / 2);
          }
        } else {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(cellX, cellY, CELL_SIZE, CELL_SIZE);
        }

        // 网格线
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(cellX, cellY, CELL_SIZE, CELL_SIZE);
      }
    }

    // 生成预览图
    const dataUrl = canvas.toDataURL('image/png');
    setExportPreviewDataUrl(dataUrl);
    setIsExportPreviewLoading(false);
  }, [gridState.config, composedCells]);

  const handleExport = useCallback(() => {
    // 打开导出面板
    setIsExportPanelOpen(true);
    generateExportPreview('number');
  }, [generateExportPreview]);

  const downloadExport = useCallback(() => {
    if (!exportPreviewDataUrl) return;

    const link = document.createElement('a');
    link.download = `${BRAND_SHORT_NAME}_图纸_${Date.now()}.png`;
    link.href = exportPreviewDataUrl;
    link.click();
  }, [exportPreviewDataUrl]);

  const downloadJson = useCallback(() => {
    const jsonData = {
      width: gridState.config.width,
      height: gridState.config.height,
      points: [] as Array<{ x: number; y: number; hex: string }>,
    };

    for (let y = 0; y < gridState.config.height; y++) {
      for (let x = 0; x < gridState.config.width; x++) {
        const cell = composedCells[y]?.[x];
        if (cell) {
          jsonData.points.push({ x, y, hex: cell.hex });
        }
      }
    }

    const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.download = `${BRAND_SHORT_NAME}_工程_${Date.now()}.json`;
    link.href = URL.createObjectURL(blob);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }, [gridState.config, composedCells]);

  const handleClearCanvas = useCallback(() => {
    // 清除画布：重置所有单元格
    if (window.confirm('确定要清除画布吗？此操作不可恢复。')) {
      const emptyCells = Array(gridState.config.height).fill(null).map(() => Array(gridState.config.width).fill(null));
      loadGridData(emptyCells, { width: gridState.config.width, height: gridState.config.height });
      setIsMenuModalOpen(false);
    }
  }, [gridState.config, loadGridData]);

  const handleGridLoaded = useCallback(
    (cells: GridCell[][], width: number, height: number, overlayImage: string | null) => {
      loadGridData(cells, { width, height });
      if (overlayImage) {
        setOverlayImage(overlayImage);
      }
      setIsImportModalOpen(false);
    },
    [loadGridData],
  );

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
  }, []);

  const handleToolClick = useCallback(
    (toolId: string) => {
      switch (toolId) {
        case 'import':
          setIsImportModalOpen(true);
          break;
        case 'paint':
          setDrawMode('paint');
          setShowQuickColors(true);
          setSelectedColorForFill(null);
          break;
        case 'erase':
          setDrawMode('erase');
          setShowQuickColors(false);
          setSelectedColorForFill(null);
          break;
        case 'pick':
          setDrawMode('pick');
          setShowQuickColors(false);
          setSelectedColorForFill(null);
          break;
        case 'line':
          setDrawMode('line');
          setShowQuickColors(false);
          setSelectedColorForFill(null);
          break;
        case 'rect':
          setDrawMode('rectangle');
          setShowQuickColors(false);
          setSelectedColorForFill(null);
          break;
        case 'circle':
          setDrawMode('ellipse');
          setShowQuickColors(false);
          setSelectedColorForFill(null);
          break;
        case 'select-color':
          // 选择颜色模式：点击后可以选择对应颜色的所有格子
          setShowQuickColors(true);
          break;
        default:
          setShowQuickColors(false);
      }
    },
    [setDrawMode],
  );

  // 处理颜色选择（用于选色填充功能）
  const handleSelectColorForFill = useCallback(
    (color: Color) => {
      setSelectedColorForFill(color);
      setShowQuickColors(false);
    },
    [],
  );

  const handleColorSelect = useCallback(
    (color: Color) => {
      selectPaletteColor(color);
      setIsColorPickerOpen(false);
    },
    [selectPaletteColor],
  );

  // 最近使用的颜色
  const [recentColors, setRecentColors] = useState<Color[]>([]);

  const handleQuickColorSelect = useCallback(
    (color: Color) => {
      // 單擊：設置當前顏色並進入繪畫模式
      selectPaletteColor(color);
      setDrawMode('paint');
      // 不關閉面板
      setRecentColors((prev) => {
        const filtered = prev.filter((c) => c.hex !== color.hex);
        return [color, ...filtered].slice(0, 6);
      });
    },
    [selectPaletteColor, setDrawMode],
  );

  const handlePaletteColorSelect = useCallback(
    (color: Color) => {
      selectPaletteColor(color);
      setRecentColors(prev => {
        const filtered = prev.filter(c => c.hex !== color.hex);
        return [color, ...filtered].slice(0, 6);
      });
      setIsColorPickerOpen(false);
    },
    [selectPaletteColor],
  );

  // 编辑快捷颜色
  const handleSetQuickColor = useCallback(
    (slotIndex: number, colorIndex: number) => {
      setCustomQuickColors(prev => {
        const newColors = [...prev];
        newColors[slotIndex] = colorIndex;
        return newColors;
      });
    },
    [],
  );

  const handleEnterEditQuickColors = useCallback(() => {
    setIsEditingQuickColors(true);
  }, []);

  const handleExitEditQuickColors = useCallback(() => {
    setIsEditingQuickColors(false);
  }, []);

  // 初始化色卡
  useEffect(() => {
    if (!gridState.palette) {
      setPalette(mardPalette as ColorPalette);
    }
  }, [gridState.palette, setPalette]);

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  const stats = useMemo(() => {
    const uniqueColors = new Set<string>();
    let totalBeans = 0;

    for (const row of composedCells) {
      for (const cell of row) {
        if (!cell) continue;
        totalBeans += 1;
        uniqueColors.add(cell.hex);
      }
    }

    return { totalBeans, uniqueColors: uniqueColors.size };
  }, [composedCells]);

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-gray-100 via-gray-50 to-orange-50 flex flex-col overflow-hidden safe-area-inset">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between h-14 px-4 bg-white/60 backdrop-blur-sm border-b border-gray-200/50">
        <div className="flex items-center gap-2">
          <button
            onClick={undo}
            disabled={!canUndo}
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
              canUndo ? 'bg-white shadow-sm hover:shadow-md' : 'bg-gray-100 opacity-50'
            }`}
          >
            <svg className="w-5 h-5 text-gray-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 7v6h6" />
              <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13" />
            </svg>
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
              canRedo ? 'bg-white shadow-sm hover:shadow-md' : 'bg-gray-100 opacity-50'
            }`}
          >
            <svg className="w-5 h-5 text-gray-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 7v6h-6" />
              <path d="M3 17a9 9 0 019-9 9 9 0 016 2.3l3 3.7" />
            </svg>
          </button>
        </div>

        <h1 className="text-[15px] font-bold text-gray-800">{projectName}</h1>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsMenuModalOpen(true)}
            className="w-9 h-9 rounded-xl bg-white shadow-sm flex items-center justify-center hover:shadow-md transition-all"
          >
            <svg className="w-5 h-5 text-gray-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* 画布区域 - 居中显示 */}
      <div
        className="flex-1 overflow-hidden relative flex items-center justify-center"
        ref={canvasContainerRef}
      >
        <div className="w-full h-full">
          <GridEditor
              gridState={gridState}
              hoverLayerPreview={[]}
              selectionPoints={selectionPoints}
              viewMode={viewMode}
              overlayImage={overlayImage}
              overlayOpacity={overlayOpacity}
              previewPoints={previewPoints}
              previewColor={previewColor}
              drawMode={drawMode}
              onCellMouseDown={handleMouseDown}
              onCellMouseEnter={handleMouseEnter}
              onGlobalMouseUp={handleMouseUp}
              onDrawModeChange={setDrawMode}
              onSelectColor={handleColorSelect}
            />
          </div>
      </div>

      {/* 视图模式切换 - Viewport 下方 */}
      <div className="px-4 py-2">
        <div className="flex items-center gap-2">
          {/* 三个模式按钮 */}
          <div className="flex gap-1 p-0.5 bg-gray-100/80 rounded-xl">
            <button
              onClick={() => setViewMode('color')}
              className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] font-bold transition-all flex items-center justify-center gap-1 ${
                viewMode === 'color' ? 'bg-[#FF6B6B] text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200/60'
              }`}
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
              </svg>
              像素
            </button>
            <button
              onClick={() => setViewMode('number')}
              className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] font-bold transition-all flex items-center justify-center gap-1 ${
                viewMode === 'number' ? 'bg-[#FF6B6B] text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200/60'
              }`}
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="4" y1="9" x2="20" y2="9" />
                <line x1="4" y1="15" x2="20" y2="15" />
                <line x1="9" y1="4" x2="9" y2="20" />
                <line x1="15" y1="4" x2="15" y2="20" />
              </svg>
              编号
            </button>
            <button
              onClick={() => setViewMode('overlay')}
              className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] font-bold transition-all flex items-center justify-center gap-1 ${
                viewMode === 'overlay' ? 'bg-[#FF6B6B] text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200/60'
              }`}
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
              临摹
            </button>
          </div>
          {/* Info Pill - 显示统计信息 */}
          <div className="flex items-center gap-2 px-2.5 py-1.5 bg-white/90 backdrop-blur-sm rounded-xl border border-gray-200/60 shadow-sm">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-gradient-to-br from-[#FF6B6B] to-[#FF8E8E]" />
              <span className="text-[10px] font-bold text-gray-700">{stats.uniqueColors} 色</span>
            </div>
            <div className="w-px h-3 bg-gray-200" />
            <div className="flex items-center gap-1.5">
              <svg className="w-2.5 h-2.5 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="3" />
                <circle cx="6" cy="6" r="3" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="18" r="3" />
              </svg>
              <span className="text-[10px] font-bold text-gray-700">{stats.totalBeans}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 底部工具栏区域 */}
      <div className="bg-white/80 backdrop-blur-sm border-t border-gray-200/50 pb-6 pt-4">
        {/* 快捷颜色面板 - 固定在工具栏上方 */}
        {showQuickColors && !isEditingQuickColors && (
          <div className="px-4 mb-4">
            <div className="bg-white rounded-3xl shadow-lg border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-gray-500">
                  {selectedColorForFill ? '选择要填充的颜色' : '选择颜色'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleEnterEditQuickColors}
                    className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
                    title="编辑快捷颜色"
                  >
                    <svg className="w-3.5 h-3.5 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setShowQuickColors(false)}
                    className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>
              {/* 8 个快捷颜色 */}
              <div className="grid grid-cols-8 gap-2">
                {customQuickColors.map((colorIndex, slotIndex) => {
                  const color = gridState.palette?.colors[colorIndex];
                  if (!color) return null;
                  const isSelected = selectedColorForFill?.hex === color.hex;
                  return (
                    <button
                      key={slotIndex}
                      onClick={() => {
                        if (drawMode === 'select-color' || selectedColorForFill) {
                          handleSelectColorForFill(color);
                        } else {
                          handleQuickColorSelect(color);
                        }
                      }}
                      className={`aspect-square rounded-xl shadow-sm transition-all ${
                        isSelected ? 'ring-2 ring-[#FF6B6B] ring-offset-2 scale-105' : 'border-2 border-gray-200'
                      }`}
                      style={{ backgroundColor: color.hex }}
                      title={color.name || color.hex}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* 编辑快捷颜色面板 */}
        {showQuickColors && isEditingQuickColors && (
          <div className="px-4 mb-4">
            <div className="bg-white rounded-3xl shadow-lg border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-semibold text-gray-500">
                  {selectedEditSlot !== null ? '点击色卡选择颜色' : '点击槽位编辑颜色'}
                </span>
                <button
                  onClick={handleExitEditQuickColors}
                  className="w-8 h-8 rounded-full bg-[#FF6B6B] flex items-center justify-center hover:bg-[#FF7B7B] transition-colors"
                >
                  <span className="text-xs font-bold text-white">完成</span>
                </button>
              </div>
              {/* 当前快捷颜色槽位 */}
              <div className="mb-4">
                <span className="text-[10px] text-gray-400 mb-2 block">点击槽位编辑</span>
                <div className="grid grid-cols-8 gap-2">
                  {customQuickColors.map((colorIndex, slotIndex) => {
                    const color = gridState.palette?.colors[colorIndex];
                    const isSelected = selectedEditSlot === slotIndex;
                    return (
                      <button
                        key={slotIndex}
                        onClick={() => setSelectedEditSlot(slotIndex)}
                        className={`aspect-square rounded-xl flex items-center justify-center transition-all ${
                          isSelected
                            ? 'ring-2 ring-[#FF6B6B] ring-offset-2'
                            : 'border-2 border-dashed border-gray-300 bg-gray-50'
                        }`}
                      >
                        {color && (
                          <div
                            className="w-6 h-6 rounded-md shadow-sm"
                            style={{ backgroundColor: color.hex }}
                            title={color.name || color.hex}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* 色卡选择区 */}
              <div>
                <span className="text-[10px] text-gray-400 mb-2 block">选择颜色</span>
                <div className="grid grid-cols-8 gap-1.5 max-h-[150px] overflow-y-auto">
                  {gridState.palette?.colors.map((color, colorIndex) => (
                    <button
                      key={colorIndex}
                      onClick={() => {
                        if (selectedEditSlot !== null) {
                          handleSetQuickColor(selectedEditSlot, colorIndex);
                          setSelectedEditSlot(null);
                        }
                      }}
                      className="aspect-square rounded-lg shadow-sm border border-gray-200"
                      style={{ backgroundColor: color.hex }}
                      title={color.name || color.hex}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 工具栏 - 两排每排 4 个 */}
        <div className="px-4">
          <div className="bg-white rounded-3xl shadow-lg border border-gray-100 p-4">
            <div className="grid grid-cols-4 gap-3">
              {TOOLS.map((tool) => {
                const isActive =
                  (tool.id === 'paint' && drawMode === 'paint') ||
                  (tool.id === 'erase' && drawMode === 'erase') ||
                  (tool.id === 'pick' && drawMode === 'pick') ||
                  (tool.id === 'line' && drawMode === 'line') ||
                  (tool.id === 'rect' && drawMode === 'rectangle') ||
                  (tool.id === 'circle' && drawMode === 'ellipse') ||
                  (tool.id === 'select-color' && selectedColorForFill !== null);

                return (
                  <button
                    key={tool.id}
                    onClick={() => handleToolClick(tool.id)}
                    className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl transition-all ${
                      isActive
                        ? 'bg-gradient-to-br from-gray-800 to-gray-900 text-white shadow-lg scale-105'
                        : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        isActive ? 'bg-white/20' : ''
                      }`}
                      style={!isActive ? { backgroundColor: tool.color + '15' } : {}}
                    >
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke={isActive ? '#fff' : tool.color} strokeWidth="2">
                        {tool.icon === 'image-plus' && (
                          <>
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <path d="M21 15l-5-5L5 21" />
                          </>
                        )}
                        {tool.icon === 'paintbrush' && <path d="M18 12l-8.5 8.5a2.121 2.121 0 01-3 0l-2-2a2.121 2.121 0 010-3L12 7" />}
                        {tool.icon === 'eraser' && (
                          <path d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8L14.8 1.6c.8-.8 2-.8 2.8 0l4.4 4.4c.8.8.8 2 0 2.8L11 20" />
                        )}
                        {tool.icon === 'pipette' && (
                          <path d="M12 2L8 6m4-4l4 4M4 10l8-8 8 8c1.1 1.1 1.1 3 0 4.1L12 22 4 14.1c-1.1-1.1-1.1-3 0-4.1z" />
                        )}
                        {tool.icon === 'move-diagonal' && <path d="M5 5h6M5 5v6M5 5l10 10M19 19h-6M19 19v-6" />}
                        {tool.icon === 'square' && <rect x="3" y="3" width="18" height="18" rx="2" />}
                        {tool.icon === 'circle' && <circle cx="12" cy="12" r="9" />}
                        {tool.icon === 'droplet' && <path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z" />}
                      </svg>
                    </div>
                    <span className="text-[11px] font-medium">{tool.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 导入弹窗 */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-[430px] bg-[#FFFAF2] rounded-t-3xl max-h-[90vh] overflow-y-auto">
            {/* 头部 */}
            <div className="flex items-center justify-between h-16 px-5 border-b border-gray-100 sticky top-0 bg-[#FFFAF2] z-10">
              <button onClick={() => setIsImportModalOpen(false)} className="w-10 h-10 rounded-full bg-white flex items-center justify-center">
                <svg className="w-5 h-5 text-gray-900" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
              <h2 className="text-lg font-bold text-gray-900">智能抠图</h2>
              <div className="w-10 h-10" />
            </div>

            {/* 内容 - 使用 ImageProcessor 组件 */}
            <div className="min-h-0 flex-1">
              <ImageProcessor
                palette={gridState.palette?.colors ?? null}
                targetConfig={gridState.config}
                onGridLoaded={handleGridLoaded}
                variant="modal"
                initialImageFile={pendingImportFile}
                initialPreviewImageUrl={pendingImportFile ? null : importPreviewImage}
                onRequestImageFile={() => importFileInputRef.current?.click()}
                enableExperimentalModes
                defaultAlgorithmMode="legacy-clean"
                onProcessed={() => {
                  setIsImportModalOpen(false);
                  setPendingImportFile(null);
                }}
                onPreviewChange={setImportPreviewImage}
                onColorControlsChange={handleImportColorControlsChange}
              />
            </div>

            {/* 隐藏的文件输入 */}
            <input
              ref={importFileInputRef}
              type="file"
              accept="image/jpeg,image/png"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
        </div>
      )}

      {/* 菜单设置弹窗 */}
      {isMenuModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-[430px] bg-[#FFFAF2] rounded-t-3xl max-h-[90vh] overflow-y-auto">
            {/* 头部 */}
            <div className="flex items-center justify-between h-16 px-5 border-b border-gray-100">
              <button onClick={() => setIsMenuModalOpen(false)} className="w-10 h-10 rounded-full bg-white flex items-center justify-center">
                <svg className="w-5 h-5 text-gray-900" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
              <h2 className="text-lg font-bold text-gray-900">菜单设置</h2>
              <div className="w-10 h-10" />
            </div>

            {/* 内容 */}
            <div className="p-5 space-y-4">
              {/* 临摹透明度 */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-gray-500">临摹透明度</p>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-gray-400">0%</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={overlayOpacity * 100}
                    onChange={(e) => setOverlayOpacity(Number(e.target.value) / 100)}
                    className="flex-1 h-2 bg-gray-200 rounded-full appearance-none accent-[#FF6B6B]"
                  />
                  <span className="text-xs font-semibold text-gray-900">100%</span>
                </div>
                <p className="text-sm font-bold text-[#FF6B6B]">{Math.round(overlayOpacity * 100)}%</p>
              </div>

              {/* 调整原图 */}
              <div className="space-y-3 pt-2">
                <p className="text-xs font-semibold text-gray-500">调整原图</p>
                <button
                  onClick={handleAdjustOriginal}
                  className="w-full flex items-center gap-3 p-4 bg-white rounded-2xl"
                >
                  <svg className="w-6 h-6 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="M21 15l-5-5L5 21" />
                  </svg>
                  <span className="text-sm font-semibold text-gray-900">替换/调整原图</span>
                </button>
              </div>

              {/* 操作按钮 */}
              <div className="space-y-3 pt-2">
                <button
                  onClick={handleExport}
                  className="w-full flex items-center gap-3 p-4 bg-white rounded-2xl"
                >
                  <svg className="w-6 h-6 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="7,10 12,15 17,10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <span className="text-sm font-semibold text-gray-900">导出图纸</span>
                </button>

                <button
                  onClick={handleClearCanvas}
                  className="w-full flex items-center gap-3 p-4 bg-[#FEF2F2] rounded-2xl"
                >
                  <svg className="w-6 h-6 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3,6 5,6 21,6" />
                    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                  <span className="text-sm font-semibold text-red-600">清除画布</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 颜色选择器 */}
      {isColorPickerOpen && (
        <div className="fixed inset-0 z-50 bg-white">
          {/* 状态栏 */}
          <div className="flex items-center justify-between h-[62px] px-4">
            <span className="text-[17px] font-semibold">{BRAND_SHORT_NAME}</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[14px] text-gray-500">9:41</span>
              <div className="w-5 h-5">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <rect x="2" y="7" width="16" height="10" rx="2" />
                  <rect x="20" y="11" width="2" height="2" />
                </svg>
              </div>
            </div>
          </div>

          {/* 头部 */}
          <div className="flex items-center justify-between h-14 px-4 border-b border-gray-100">
            <h2 className="text-base font-bold text-gray-900">选择颜色</h2>
            <button
              onClick={() => setIsColorPickerOpen(false)}
              className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* 颜色内容 */}
          <div className="p-5 space-y-5 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 180px)' }}>
            {/* 最近使用 */}
            {recentColors.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-gray-500">最近使用</p>
                <div className="flex gap-3 flex-wrap">
                  {recentColors.map((color, index) => (
                    <button
                      key={index}
                      onClick={() => handlePaletteColorSelect(color)}
                      className="w-12 h-12 rounded-2xl shadow-sm border border-gray-200"
                      style={{ backgroundColor: color.hex }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* MARD 色卡 */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-500">MARD 色卡</p>
              <div className="grid grid-cols-6 gap-2">
                {gridState.palette?.colors.map((color, index) => (
                  <button
                    key={index}
                    onClick={() => handlePaletteColorSelect(color)}
                    className="aspect-square rounded-xl shadow-sm border border-gray-200"
                    style={{ backgroundColor: color.hex }}
                    title={color.name || color.hex}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 导出面板 */}
      {isExportPanelOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-[430px] bg-[#FFFAF2] rounded-t-3xl max-h-[90vh] overflow-y-auto">
            {/* 头部 */}
            <div className="flex items-center justify-between h-16 px-5 border-b border-gray-100 sticky top-0 bg-[#FFFAF2] z-10">
              <button onClick={() => setIsExportPanelOpen(false)} className="w-10 h-10 rounded-full bg-white flex items-center justify-center">
                <svg className="w-5 h-5 text-gray-900" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
              <h2 className="text-lg font-bold text-gray-900">导出图纸</h2>
              <div className="w-10 h-10" />
            </div>

            {/* 内容 */}
            <div className="p-5 space-y-4">
              {/* 导出模式选择 */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-500">导出模式</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => generateExportPreview('color')}
                    className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                      exportMode === 'color' ? 'bg-[#FF6B6B] text-white' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="3" y="3" width="7" height="7" />
                      <rect x="14" y="3" width="7" height="7" />
                      <rect x="3" y="14" width="7" height="7" />
                      <rect x="14" y="14" width="7" height="7" />
                    </svg>
                    像素
                  </button>
                  <button
                    onClick={() => generateExportPreview('number')}
                    className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                      exportMode === 'number' ? 'bg-[#FF6B6B] text-white' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="4" y1="9" x2="20" y2="9" />
                      <line x1="4" y1="15" x2="20" y2="15" />
                      <line x1="9" y1="4" x2="9" y2="20" />
                      <line x1="15" y1="4" x2="15" y2="20" />
                    </svg>
                    编号
                  </button>
                </div>
              </div>

              {/* 预览区域 */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-500">预览</p>
                <div className="bg-white rounded-2xl border border-gray-200 p-4 min-h-[200px] flex items-center justify-center">
                  {isExportPreviewLoading ? (
                    <div className="text-center text-gray-500">
                      <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin mx-auto mb-2" />
                      <p className="text-sm">生成中...</p>
                    </div>
                  ) : exportPreviewDataUrl ? (
                    <img src={exportPreviewDataUrl} alt="导出预览" className="max-w-full h-auto rounded-lg" />
                  ) : (
                    <p className="text-sm text-gray-400">请选择导出模式</p>
                  )}
                </div>
              </div>

              {/* 导出按钮 */}
              <div className="space-y-3 pt-2">
                <button
                  onClick={downloadExport}
                  disabled={!exportPreviewDataUrl}
                  className={`w-full flex items-center justify-center gap-2 p-4 rounded-2xl font-semibold transition-all ${
                    exportPreviewDataUrl
                      ? 'bg-[#FF6B6B] text-white'
                      : 'bg-gray-200 text-gray-400'
                  }`}
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="7,10 12,15 17,10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  下载图纸图片
                </button>

                <button
                  onClick={downloadJson}
                  className="w-full flex items-center justify-center gap-2 p-4 bg-white border-2 border-gray-200 rounded-2xl font-semibold text-gray-700 hover:border-gray-300 transition-all"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" />
                    <polyline points="14,2 14,8 20,8" />
                  </svg>
                  下载 JSON 工程
                </button>
              </div>

              {/* 统计信息 */}
              <div className="bg-white rounded-2xl p-4 space-y-2">
                <p className="text-xs font-semibold text-gray-500">统计信息</p>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">画布尺寸</span>
                  <span className="font-semibold text-gray-900">{gridState.config.width} × {gridState.config.height}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">总豆子数</span>
                  <span className="font-semibold text-gray-900">{stats.totalBeans}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">颜色数量</span>
                  <span className="font-semibold text-gray-900">{stats.uniqueColors}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
