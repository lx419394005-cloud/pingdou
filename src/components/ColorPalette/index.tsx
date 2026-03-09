import React, { useMemo, useRef, useState } from 'react';
import type { Color, ColorPalette as ColorPaletteType } from '../../types';
import { detectColorGrid, extractColorsFromCanvas } from '../../algorithms/colorExtractor';

interface ColorPaletteProps {
  palette: ColorPaletteType | null;
  selectedColor: Color | null;
  onSelectColor: (color: Color) => void;
  onPaletteLoad: (palette: ColorPaletteType) => void;
  compact?: boolean;
}

export const ColorPalette: React.FC<ColorPaletteProps> = ({
  palette,
  selectedColor,
  onSelectColor,
  onPaletteLoad,
  compact = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const handleJsonImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        const colors = json.colors.map((c: { name: string; hex: string; rgb?: { r: number; g: number; b: number } }) => ({
          ...c,
          rgb: c.rgb || hexToRgb(c.hex),
        }));
        onPaletteLoad({ ...json, colors });
      } catch {
        alert('JSON 格式错误');
      }
    };
    reader.readAsText(file);
  };

  const handleImageImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        ctx.drawImage(img, 0, 0);
        
        try {
          const gridResult = detectColorGrid(canvas);
          const colors = extractColorsFromCanvas(canvas, gridResult);
          
          if (colors.length === 0) {
            alert('未检测到色块，请确保色卡图片清晰');
            return;
          }

          onPaletteLoad({
            id: `custom-${Date.now()}`,
            name: '自定义色卡',
            brand: 'Custom',
            colors,
          });
        } catch {
          alert('色卡识别失败');
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
    } : { r: 0, g: 0, b: 0 };
  };

  const filteredColors = useMemo(() => {
    if (!palette) {
      return [];
    }

    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return palette.colors;
    }

    return palette.colors.filter((color) => (
      color.name.toLowerCase().includes(query)
      || color.hex.toLowerCase().includes(query)
    ));
  }, [palette, searchQuery]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold text-gray-500 tracking-[0.24em]">豆子颜色</h3>
        {palette && <span className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-500 font-mono">{palette.colors.length}</span>}
      </div>

      {!compact && (
        <div className="grid grid-cols-2 gap-2 mb-4">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="py-2 bg-gray-100 text-gray-600 text-[11px] font-bold rounded-lg hover:bg-gray-200 transition-colors flex items-center justify-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          导入 JSON
        </button>
        <button
          onClick={() => document.getElementById('image-input')?.click()}
          className="py-2 bg-gray-100 text-gray-600 text-[11px] font-bold rounded-lg hover:bg-gray-200 transition-colors flex items-center justify-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          识别色卡图
        </button>
        </div>
      )}

      {selectedColor && !compact && (
        <div className="mb-4 rounded-2xl border border-orange-100 bg-orange-50/70 p-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl border border-white" style={{ backgroundColor: selectedColor.hex }} />
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-gray-800">{selectedColor.name}</p>
              <p className="text-xs font-medium text-gray-500">{selectedColor.hex}</p>
            </div>
          </div>
        </div>
      )}

      {palette && (
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="mb-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索颜色名或 HEX"
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 outline-none transition placeholder:text-gray-400 focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
            />
          </div>
          <div className="rounded-2xl border border-gray-100 bg-gray-50 p-2">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[10px] font-black text-gray-500">{palette.name}</span>
              <span className="text-[10px] text-gray-400">
                {palette.brand} · {filteredColors.length}/{palette.colors.length}
              </span>
            </div>
            <div className={`grid ${compact ? 'max-h-52 grid-cols-6' : 'max-h-[calc(100vh-18rem)] grid-cols-5'} gap-1 overflow-y-auto pr-1 custom-scrollbar pb-1`}>
            {filteredColors.map((color, index) => {
              const { r, g, b } = color.rgb;
              const brightness = (r * 299 + g * 587 + b * 114) / 1000;
              const textColor = brightness > 128 ? '#000000' : '#FFFFFF';

              return (
                <button
                  key={index}
                  onClick={() => onSelectColor(color)}
                  className={`relative z-0 flex aspect-square items-center justify-center ${compact ? 'rounded-lg' : 'rounded-xl'} border transition-all hover:z-10 hover:scale-105 ${
                    selectedColor?.hex === color.hex ? 'border-orange-500 ring-2 ring-orange-200 scale-105 z-10' : 'border-gray-200'
                  }`}
                  style={{ backgroundColor: color.hex }}
                  title={`${color.name}: ${color.hex}`}
                >
                  <span 
                    className="pointer-events-none text-[8px] font-black opacity-70"
                    style={{ color: textColor }}
                  >
                    {color.name}
                  </span>
                </button>
              );
            })}
            {filteredColors.length === 0 && (
              <div className={`col-span-full rounded-xl border border-dashed border-gray-200 bg-white py-4 text-center text-xs text-gray-400 ${compact ? 'text-[10px]' : ''}`}>
                没有匹配颜色
              </div>
            )}
            </div>
          </div>
        </div>
      )}

      {!palette && (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-center text-xs text-gray-400">
          尚未载入色卡
        </div>
      )}

      <input ref={fileInputRef} type="file" accept=".json" onChange={handleJsonImport} className="hidden" />
      <input id="image-input" type="file" accept="image/*" onChange={handleImageImport} className="hidden" />
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};
