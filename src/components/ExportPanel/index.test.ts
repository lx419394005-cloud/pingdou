import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExportPanel } from './index';
import type { GridState } from '../../types';

const gridState: GridState = {
  config: { width: 50, height: 50 },
  cells: Array.from({ length: 50 }, () => Array.from({ length: 50 }, () => null)),
  palette: null,
  layers: [{
    id: 'layer-1',
    name: '图层 1',
    visible: true,
    cells: Array.from({ length: 50 }, () => Array.from({ length: 50 }, () => null)),
  }],
  activeLayerId: 'layer-1',
};

describe('ExportPanel', () => {
  it('shows a single primary export button before opening modal options', () => {
    const html = renderToStaticMarkup(
      React.createElement(ExportPanel, { gridState, overlayImage: null, compact: true }),
    );

    expect(html).toContain('导出图纸');
    expect(html).not.toContain('导出标号图纸');
    expect(html).not.toContain('导出工程 JSON');
  });
});
