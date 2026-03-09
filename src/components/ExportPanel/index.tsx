import React, { useMemo, useState } from 'react';
import type { GridState } from '../../types';
import { buildColorCodeMap, buildIndexedPalette } from '../../utils/pattern';
import { getPatternCellTextStyle, getPatternGridLineStyle, getPatternNumberCellStyle } from '../../utils/patternCanvas';

interface ExportPanelProps {
  gridState: GridState;
  overlayImage: string | null;
  compact?: boolean;
}

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

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = reject;
  image.src = src;
});

export const ExportPanel: React.FC<ExportPanelProps> = ({ gridState, overlayImage, compact = false }) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const indexedPalette = useMemo(() => buildIndexedPalette(gridState.cells), [gridState.cells]);
  const colorCodeMap = useMemo(() => buildColorCodeMap(gridState.cells), [gridState.cells]);
  const totalBeans = indexedPalette.reduce((sum, entry) => sum + entry.count, 0);

  const drawPatternSheet = async (mode: 'color' | 'number' | 'overlay') => {
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
    ctx.fillText('拼豆图纸', PADDING, 38);
    ctx.font = '600 13px sans-serif';
    ctx.fillStyle = '#6b7280';
    ctx.fillText(`尺寸 ${width} × ${height} | 总豆数 ${totalBeans} | 颜色数 ${indexedPalette.length}`, PADDING, 62);
    ctx.fillText(`导出模式：${mode === 'color' ? '像素图纸' : mode === 'number' ? '标号图纸' : '临摹图纸'}`, PADDING, 82);

    const gridX = PADDING + GUTTER;
    const gridY = HEADER_HEIGHT + GUTTER;

    if (mode === 'overlay' && overlayImage) {
      const overlayBitmap = await loadImage(overlayImage);
      ctx.save();
      ctx.globalAlpha = 0.36;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(overlayBitmap, gridX, gridY, gridWidth, gridHeight);
      ctx.restore();
    }

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
            if (mode === 'overlay') {
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
              ctx.save();
              ctx.globalAlpha = 0.32;
              ctx.fillStyle = cell.hex;
              ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
              ctx.restore();
            } else {
              const cellStyle = getPatternNumberCellStyle(cell.hex);
              ctx.fillStyle = cellStyle.fillColor;
              ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
            }

            const code = colorCodeMap.get(cell.hex) ?? 0;
            const labelStyle = getPatternCellTextStyle(mode, CELL_SIZE);
            ctx.fillStyle = mode === 'number' ? getPatternNumberCellStyle(cell.hex).textColor : labelStyle.textColor;
            ctx.font = `700 ${labelStyle.fontSize}px sans-serif`;
            ctx.fillText(String(code), px + (CELL_SIZE / 2), py + (CELL_SIZE / 2));
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

        ctx.fillStyle = '#111827';
        ctx.font = '900 12px sans-serif';
        ctx.fillText(String(entry.code), legendX + 16, legendY + 16);
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
  };

  const exportPattern = async (mode: 'color' | 'number' | 'overlay', label: string) => {
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
      `拼豆图纸-${Date.now()}.json`,
    );
  };

  const exportCsv = () => {
    const content = [
      '编号,颜色名,HEX,数量',
      ...indexedPalette.map((entry) => `${entry.code},${entry.color.name},${entry.color.hex},${entry.count}`),
    ].join('\n');

    downloadBlob(new Blob([content], { type: 'text/csv;charset=utf-8' }), `拼豆清单-${Date.now()}.csv`);
  };

  const exportAll = async () => {
    await exportPattern('color', '像素图纸');
    await exportPattern('number', '标号图纸');
    if (overlayImage) {
      await exportPattern('overlay', '临摹图纸');
    }
    exportCsv();
    exportJson();
  };

  return (
    <div className="rounded-[28px] border border-[#eadfd0] bg-white p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-black text-gray-800">图纸导出</h3>
          <p className="text-xs text-gray-500">导出完整图纸、编号图例和用量清单</p>
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
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-900 text-[11px] font-black text-white">
                  {entry.code}
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

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => exportPattern('color', '像素图纸')}
                className="rounded-xl bg-gray-900 px-3 py-2 text-xs font-black text-white transition hover:bg-black"
              >
                导出像素图纸
              </button>
              <button
                onClick={() => exportPattern('number', '标号图纸')}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 transition hover:bg-gray-50"
              >
                导出标号图纸
              </button>
              <button
                onClick={() => exportPattern('overlay', '临摹图纸')}
                disabled={!overlayImage}
                className={`rounded-xl px-3 py-2 text-xs font-black transition ${
                  overlayImage
                    ? 'border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100'
                    : 'cursor-not-allowed border border-gray-100 bg-gray-100 text-gray-400'
                }`}
              >
                导出临摹图纸
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
