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
    expect(html).toContain('导入 JSON');
    expect(html).toContain('粘贴 JSON');
  });

  it('does not duplicate import actions inside the import modal header', () => {
    const html = renderToStaticMarkup(React.createElement(App));
    expect(html).not.toContain('更换图片');
  });

  it('moves color tuning into the editor instead of capping it in the import modal', () => {
    const html = renderToStaticMarkup(React.createElement(App));
    expect(html).toContain('颜色调节');
    expect(html).toContain('4 - 12 色');
    expect(html).not.toContain('自动推荐最多 8 色');
    expect(html.indexOf('颜色调节')).toBeGreaterThan(html.indexOf('当前颜色'));
    expect(html.indexOf('颜色调节')).toBeGreaterThan(html.indexOf('参考图舞台'));
  });
});
