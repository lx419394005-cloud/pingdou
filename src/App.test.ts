import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App', () => {
  it('renders the left current-color slot entry point', () => {
    const html = renderToStaticMarkup(React.createElement(App));
    expect(html).toContain('当前颜色');
    expect(html).not.toContain('打开导入窗口');
    expect(html).toContain('像素');
  });
});
