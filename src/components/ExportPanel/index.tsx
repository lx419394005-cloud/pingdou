import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GridState } from '../../types';
import { buildColorLabelMap, buildIndexedPalette, getDisplayCode } from '../../utils/pattern';
import { getPatternCellTextStyle, getPatternGridLineStyle, getPatternNumberCellStyle } from '../../utils/patternCanvas';
import { BRAND_EXPORT_PREFIX, BRAND_SHORT_NAME } from '../../config/brand';

interface ExportPanelProps {
  gridState: GridState;
  compact?: boolean;
}
type ExportMode = 'color' | 'number';

const CELL_SIZE = 24;
const HEADER_HEIGHT = 92;
const GUTTER = 40;
const PADDING = 28;
const LEGEND_WIDTH = 280;

const downloadDataUrl = (dataUrl: string, filename: string) => {
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  link.click();
};

const downloadBlob = (blob: Blob, filename: string) => {
  const link = document.createElement('a');
  link.download = filename;
  link.href = URL.createObjectURL(blob);
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};

export const ExportPanel: React.FC<ExportPanelProps> = ({ gridState, compact = false }) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const previewRequestRef = useRef(0);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<ExportMode>('number');
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const indexedPalette = useMemo(() => buildIndexedPalette(gridState.cells), [gridState.cells]);
  const colorLabelMap = useMemo(() => buildColorLabelMap(gridState.cells), [gridState.cells]);
  const totalBeans = indexedPalette.reduce((sum, entry) => sum + entry.count, 0);

  const drawPatternSheet = useCallback(async (mode: ExportMode) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }

    const { width, height } = gridState.config;
    const hasLegend = indexedPalette.length > 0;
    const gridWidth = width * CELL_SIZE;
    const gridHeight = height * CELL_SIZE;
    const sheetWidth = PADDING + GUTTER + gridWidth + (hasLegend ? LEGEND_WIDTH : 0) + PADDING;
    const sheetHeight = HEADER_HEIGHT + GUTTER + gridHeight + PADDING;

    canvas.width = sheetWidth;
    canvas.height = sheetHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }

    ctx.fillStyle = '#fffdfa';
    ctx.fillRect(0, 0, sheetWidth, sheetHeight);

    ctx.fillStyle = '#1f2937';
    ctx.font = '900 28px sans-serif';
    ctx.fillText(`${BRAND_EXPORT_PREFIX}图纸`, PADDING, 38);
    ctx.font = '600 13px sans-serif';
    ctx.fillStyle = '#6b7280';
    ctx.fillText(`尺寸 ${width} × ${height} | 总豆数 ${totalBeans} | 颜色数 ${indexedPalette.length}`, PADDING, 62);
    ctx.fillText(`导出模式：${mode === 'color' ? '像素图纸' : '标号图纸'}`, PADDING, 82);

    const gridX = PADDING + GUTTER;
    const gridY = HEADER_HEIGHT + GUTTER;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let x = 0; x < width; x++) {
      if (width <= 20 || x % 5 === 0 || x === width - 1) {
        ctx.fillStyle = '#6b7280';
        ctx.font = '600 12px sans-serif';
        ctx.fillText(String(x + 1), gridX + (x * CELL_SIZE) + (CELL_SIZE / 2), HEADER_HEIGHT + (GUTTER / 2));
      }
    }

    for (let y = 0; y < height; y++) {
      if (height <= 20 || y % 5 === 0 || y === height - 1) {
        ctx.fillStyle = '#6b7280';
        ctx.font = '600 12px sans-serif';
        ctx.fillText(String(y + 1), PADDING + (GUTTER / 2), gridY + (y * CELL_SIZE) + (CELL_SIZE / 2));
      }
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = gridState.cells[y][x];
        const px = gridX + (x * CELL_SIZE);
        const py = gridY + (y * CELL_SIZE);

        if (mode === 'color') {
          ctx.fillStyle = cell?.hex ?? '#ffffff';
          ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
        } else {
          if (cell) {
            const cellStyle = getPatternNumberCellStyle(cell.hex);
            ctx.fillStyle = cellStyle.fillColor;
            ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);

            const codeLabel = colorLabelMap.get(cell.hex) ?? 'C1';
            const labelStyle = getPatternCellTextStyle(mode, CELL_SIZE);
            const fontSize = codeLabel.length >= 3 ? Math.max(9, labelStyle.fontSize - 2) : labelStyle.fontSize;
            ctx.fillStyle = getPatternNumberCellStyle(cell.hex).textColor;
            ctx.font = `700 ${fontSize}px sans-serif`;
            ctx.fillText(codeLabel, px + (CELL_SIZE / 2), py + (CELL_SIZE / 2));
          } else {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
          }
        }

        const verticalLineStyle = getPatternGridLineStyle(mode, x, 1);
        const horizontalLineStyle = getPatternGridLineStyle(mode, y, 1);
        const isMajorLine = verticalLineStyle.lineWidth > 1 || horizontalLineStyle.lineWidth > 1;
        ctx.strokeStyle = isMajorLine ? '#c5b8a5' : verticalLineStyle.strokeStyle;
        ctx.lineWidth = Math.max(verticalLineStyle.lineWidth, horizontalLineStyle.lineWidth);
        ctx.strokeRect(px, py, CELL_SIZE, CELL_SIZE);
      }
    }

    if (hasLegend) {
      const legendX = gridX + gridWidth + 28;
      let legendY = HEADER_HEIGHT + 12;

      ctx.fillStyle = '#1f2937';
      ctx.font = '900 18px sans-serif';
      ctx.fillText('颜色图例', legendX + 70, legendY);
      legendY += 20;

      for (const entry of indexedPalette) {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#e5ded2';
        ctx.lineWidth = 1;
        ctx.fillRect(legendX, legendY, LEGEND_WIDTH - 36, 32);
        ctx.strokeRect(legendX, legendY, LEGEND_WIDTH - 36, 32);

        const displayCode = getDisplayCode(entry.code, entry.color.name);
        ctx.fillStyle = '#111827';
        ctx.font = `900 ${displayCode.length >= 3 ? 11 : 12}px sans-serif`;
        ctx.fillText(displayCode, legendX + 16, legendY + 16);
        ctx.fillStyle = entry.color.hex;
        ctx.fillRect(legendX + 30, legendY + 7, 18, 18);
        ctx.fillStyle = '#111827';
        ctx.textAlign = 'left';
        ctx.font = '700 12px sans-serif';
        ctx.fillText(entry.color.name, legendX + 58, legendY + 13);
        ctx.font = '500 11px sans-serif';
        ctx.fillStyle = '#6b7280';
        ctx.fillText(`${entry.color.hex} · ${entry.count} 颗`, legendX + 58, legendY + 24);
        ctx.textAlign = 'center';
        legendY += 40;
      }
    }

    return canvas.toDataURL('image/png');
  }, [colorLabelMap, gridState.cells, gridState.config, indexedPalette, totalBeans]);

  const renderPreview = useCallback(async (mode: ExportMode) => {
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    setIsPreviewLoading(true);
    const dataUrl = await drawPatternSheet(mode);
    if (previewRequestRef.current !== requestId) {
      return;
    }

    setPreviewDataUrl(dataUrl);
    setIsPreviewLoading(false);
  }, [drawPatternSheet]);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    void renderPreview(previewMode);
  }, [gridState.cells, gridState.config.height, gridState.config.width, isMenuOpen, previewMode, renderPreview]);

  const exportPattern = async (mode: ExportMode, label: string) => {
    const dataUrl = await drawPatternSheet(mode);
    if (!dataUrl) {
      return;
    }

    downloadDataUrl(dataUrl, `${label}-${Date.now()}.png`);
  };

  const exportJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      config: gridState.config,
      cells: gridState.cells.map((row) => row.map((cell) => (
        cell
          ? { name: cell.name, hex: cell.hex, rgb: cell.rgb }
          : null
      ))),
      indexedPalette,
    };

    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }),
      `${BRAND_EXPORT_PREFIX}工程-${Date.now()}.json`,
    );
  };

  const exportCsv = () => {
    const content = [
      '编号,颜色名,HEX,数量',
      ...indexedPalette.map((entry) => `${getDisplayCode(entry.code, entry.color.name)},${entry.color.name},${entry.color.hex},${entry.count}`),
    ].join('\n');

    downloadBlob(new Blob([content], { type: 'text/csv;charset=utf-8' }), `${BRAND_EXPORT_PREFIX}清单-${Date.now()}.csv`);
  };

  const exportAll = async () => {
    await exportPattern('color', `${BRAND_EXPORT_PREFIX}-像素图纸`);
    await exportPattern('number', `${BRAND_EXPORT_PREFIX}-标号图纸`);
    exportCsv();
    exportJson();
  };

  return (
    <div className="rounded-[28px] border border-[#eadfd0] bg-white p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-black text-gray-800">{BRAND_SHORT_NAME}出图</h3>
          <p className="text-xs text-gray-500">导出完整图纸、编号图例和备料清单，便于直接开做</p>
        </div>
        <span className="rounded-full bg-teal-50 px-2 py-1 text-[10px] font-bold text-teal-700">
          {gridState.config.width} × {gridState.config.height}
        </span>
      </div>

      {!compact && (
        <div className="mb-4 grid grid-cols-2 gap-3 rounded-2xl border border-gray-100 bg-gray-50 p-3">
        <div>
          <div className="text-[10px] font-bold text-gray-400">总豆数</div>
          <div className="text-2xl font-black text-gray-800">{totalBeans}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-bold text-gray-400">颜色数</div>
          <div className="text-2xl font-black text-gray-800">{indexedPalette.length}</div>
        </div>
        </div>
      )}

      {!compact && (
        <div className="mb-4 max-h-48 overflow-y-auto rounded-2xl border border-gray-100 bg-gray-50 p-3 custom-scrollbar">
        <div className="space-y-2">
          {indexedPalette.map((entry) => (
            <div key={entry.color.hex} className="flex items-center justify-between rounded-xl bg-white px-3 py-2">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-7 min-w-7 items-center justify-center rounded-lg bg-gray-900 px-1 text-[10px] font-black text-white">
                  {getDisplayCode(entry.code, entry.color.name)}
                </div>
                <div className="h-5 w-5 rounded-lg border border-white" style={{ backgroundColor: entry.color.hex }} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-gray-800">{entry.color.name}</p>
                  <p className="text-[11px] text-gray-400">{entry.color.hex}</p>
                </div>
              </div>
              <span className="text-xs font-bold text-gray-500">{entry.count} 颗</span>
            </div>
          ))}
        </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setIsMenuOpen(true)}
        className="w-full rounded-2xl bg-orange-500 px-4 py-4 text-base font-black text-white transition hover:bg-orange-600"
      >
        导出图纸
      </button>

      {isMenuOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#2b241d]/45 p-4 backdrop-blur-[2px]"
          onClick={() => setIsMenuOpen(false)}
        >
          <div
            className="w-full max-w-[560px] rounded-[30px] border border-[#eadfd0] bg-[#fffaf2] p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h4 className="text-lg font-black text-gray-900">选择导出类型</h4>
                <p className="text-xs text-gray-500">先选你要导出的图纸类型，支持分项导出和全部导出。</p>
              </div>
              <button
                type="button"
                onClick={() => setIsMenuOpen(false)}
                className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 transition hover:bg-gray-50"
              >
                关闭
              </button>
            </div>

            <div className="mb-4 rounded-2xl border border-[#eadfd0] bg-[#faf6ef] p-3">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-xs font-black text-gray-700">导出预览</h4>
                <button
                  type="button"
                  onClick={() => void renderPreview(previewMode)}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[10px] font-bold text-gray-600 transition hover:bg-gray-50"
                >
                  刷新预览
                </button>
              </div>

              <div className="mb-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setPreviewMode('number')}
                  className={`rounded-lg px-2 py-1 text-[10px] font-black transition ${
                    previewMode === 'number'
                      ? 'bg-gray-900 text-white'
                      : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  标号预览
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode('color')}
                  className={`rounded-lg px-2 py-1 text-[10px] font-black transition ${
                    previewMode === 'color'
                      ? 'bg-gray-900 text-white'
                      : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  像素预览
                </button>
              </div>

              <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-[#e7dcc9] bg-white">
                {previewDataUrl ? (
                  <img src={previewDataUrl} alt="导出图纸预览" className="h-full w-full object-contain" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs font-semibold text-gray-400">暂无预览</div>
                )}
                {isPreviewLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-xs font-semibold text-gray-600">
                    生成预览中...
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => exportPattern('color', `${BRAND_EXPORT_PREFIX}-像素图纸`)}
                className="rounded-xl bg-gray-900 px-3 py-2 text-xs font-black text-white transition hover:bg-black"
              >
                导出像素图纸
              </button>
              <button
                onClick={() => exportPattern('number', `${BRAND_EXPORT_PREFIX}-标号图纸`)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 transition hover:bg-gray-50"
              >
                导出标号图纸
              </button>
              <button
                onClick={exportCsv}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 transition hover:bg-gray-50"
              >
                导出用量 CSV
              </button>
              <button
                onClick={exportJson}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 transition hover:bg-gray-50"
              >
                导出工程 JSON
              </button>
              <button
                onClick={exportAll}
                className="rounded-xl bg-orange-500 px-3 py-2 text-xs font-black text-white transition hover:bg-orange-600"
              >
                一键导出全部
              </button>
            </div>
          </div>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};
