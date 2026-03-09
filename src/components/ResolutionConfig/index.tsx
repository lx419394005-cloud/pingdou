import React from 'react';
import type { GridConfig } from '../../types';

interface ResolutionConfigProps {
  config: GridConfig;
  onResolutionChange: (width: number, height: number) => void;
}

export const ResolutionConfig: React.FC<ResolutionConfigProps> = ({
  config,
  onResolutionChange,
}) => {
  const [width, setWidth] = React.useState(config.width);
  const [height, setHeight] = React.useState(config.height);
  const [lockAspectRatio, setLockAspectRatio] = React.useState(true);

  const handleWidthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newWidth = parseInt(e.target.value) || 50;
    setWidth(newWidth);
    if (lockAspectRatio) {
      setHeight(newWidth);
    }
  };

  const handleHeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newHeight = parseInt(e.target.value) || 50;
    setHeight(newHeight);
  };

  const handleApply = () => {
    onResolutionChange(width, height);
  };

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold text-gray-400 tracking-[0.2em]">尺寸</span>
        <div className="flex items-center border border-gray-200 rounded-md overflow-hidden bg-gray-50 focus-within:ring-1 focus-within:ring-orange-400 focus-within:border-orange-400 transition-all">
          <input
            type="number"
            value={width}
            onChange={handleWidthChange}
            min={10}
            max={100}
            className="w-12 px-2 py-1 bg-transparent text-xs text-center font-medium focus:outline-none"
            title="宽度"
          />
          <span className="text-gray-300 text-[10px]">×</span>
          <input
            type="number"
            value={height}
            onChange={handleHeightChange}
            min={10}
            max={100}
            disabled={lockAspectRatio}
            className={`w-12 px-2 py-1 bg-transparent text-xs text-center font-medium focus:outline-none ${lockAspectRatio ? 'text-gray-400' : ''}`}
            title="高度"
          />
        </div>
      </div>

      <button
        onClick={() => setLockAspectRatio(!lockAspectRatio)}
        className={`p-1.5 rounded transition-colors ${lockAspectRatio ? 'text-orange-500 bg-orange-50' : 'text-gray-400 hover:bg-gray-100'}`}
        title={lockAspectRatio ? "解锁比例" : "锁定比例"}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </button>

      <button
        onClick={handleApply}
        className="px-3 py-1.5 bg-gray-800 text-white text-[10px] font-bold rounded hover:bg-gray-700 transition-all active:scale-95"
      >
        应用
      </button>
    </div>
  );
};
