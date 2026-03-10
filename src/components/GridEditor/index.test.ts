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
  it('centers small canvases with auto margins instead of justify-center so enlarged stages remain fully scrollable', () => {
    const html = renderToStaticMarkup(
      React.createElement(GridEditor, {
        gridState,
        hoverLayerPreview: [],
        selectionPoints: [],
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

    expect(html).toContain('flex min-h-full min-w-full w-max"><canvas class="block m-auto shrink-0 rounded-2xl');
    expect(html).toContain('block m-auto shrink-0 rounded-2xl');
    expect(html).toContain('pointer-events-none absolute bottom-3 right-3 z-20');
    expect(html).not.toContain('flex min-h-full min-w-full items-center justify-center');
  });

  it('reserves tooltip space inside the horizontal tool scroller instead of relying on overflow-y-visible', () => {
    const html = renderToStaticMarkup(
      React.createElement(GridEditor, {
        gridState,
        hoverLayerPreview: [],
        selectionPoints: [],
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

    expect(html).toContain('-mb-6 overflow-x-auto pb-6 no-scrollbar');
    expect(html).toContain('pb-6');
    expect(html).toContain('z-40');
    expect(html).toContain('>选择<');
    expect(html).not.toContain('overflow-y-visible');
  });

  it('renders reset zoom as a standalone action pill instead of inline hint text styling', () => {
    const html = renderToStaticMarkup(
      React.createElement(GridEditor, {
        gridState,
        hoverLayerPreview: [],
        selectionPoints: [],
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

    expect(html).toContain('aria-label="适应窗口"');
    expect(html).toContain('inline-flex items-center gap-1 rounded-full');
    expect(html).toContain('重置视图');
    expect(html).not.toContain('ml-1 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px]');
  });

  it('disables native touch gestures on the viewport so touch dragging can pan the canvas', () => {
    const html = renderToStaticMarkup(
      React.createElement(GridEditor, {
        gridState,
        hoverLayerPreview: [],
        selectionPoints: [],
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

    expect(html).toContain('touch-action:none');
  });

  it('allows horizontal touch panning on the tool scroller even when tool buttons have tooltips', () => {
    const html = renderToStaticMarkup(
      React.createElement(GridEditor, {
        gridState,
        hoverLayerPreview: [],
        selectionPoints: [],
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

    expect(html).toContain('touch-action:pan-x');
    expect(html).toContain('overscroll-behavior-x:contain');
  });
});
