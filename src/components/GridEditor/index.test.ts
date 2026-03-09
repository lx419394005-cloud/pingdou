import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GridEditor } from './index';
import type { GridState } from '../../types';

const gridState: GridState = {
  config: { width: 4, height: 4 },
  cells: Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => null)),
  palette: null,
  layers: [{
    id: 'layer-1',
    name: '图层 1',
    visible: true,
    cells: Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => null)),
  }],
  activeLayerId: 'layer-1',
};

describe('GridEditor', () => {
  it('centers the canvas stage without allowing the canvas to shrink in flex layout', () => {
    const html = renderToStaticMarkup(
      React.createElement(GridEditor, {
        gridState,
        hoverLayerPreview: [],
        viewMode: 'color',
        overlayImage: null,
        overlayOpacity: 0.5,
        previewPoints: [],
        previewColor: null,
        drawMode: 'paint',
        onDrawModeChange: () => {},
        onCellMouseDown: () => {},
        onCellMouseEnter: () => {},
        onGlobalMouseUp: () => {},
        onSelectColor: () => {},
      }),
    );

    expect(html).toContain('flex min-h-full min-w-full items-center justify-center');
    expect(html).toContain('shrink-0 rounded-2xl');
    expect(html).toContain('pointer-events-none absolute bottom-3 right-3 z-20');
    expect(html).not.toContain('grid grid-cols-[minmax(0,1fr)_auto]');
  });
});
