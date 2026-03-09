import { describe, expect, it } from 'vitest';
import type { Color } from '../types';
import {
  addLayer,
  collectLayerFilledPoints,
  composeVisibleLayers,
  createInitialLayerState,
  removeLayer,
  renameLayer,
  toggleLayerVisibility,
} from './layerState';

const red: Color = { name: '红', hex: '#ff0000', rgb: { r: 255, g: 0, b: 0 } };
const blue: Color = { name: '蓝', hex: '#0000ff', rgb: { r: 0, g: 0, b: 255 } };

describe('layerState', () => {
  it('composes visible layers from bottom to top', () => {
    const state = createInitialLayerState(2, 1);
    state.layers[0].cells[0][0] = red;
    state.layers[0].cells[0][1] = red;

    const withTop = addLayer(state, { width: 2, height: 1 });
    withTop.layers[1].cells[0][1] = blue;

    expect(composeVisibleLayers(withTop.layers, { width: 2, height: 1 })).toEqual([[red, blue]]);
  });

  it('ignores hidden layers when composing', () => {
    const state = createInitialLayerState(1, 1);
    state.layers[0].cells[0][0] = red;

    const withTop = addLayer(state, { width: 1, height: 1 });
    withTop.layers[1].cells[0][0] = blue;
    const hiddenTop = toggleLayerVisibility(withTop, withTop.layers[1].id);

    expect(composeVisibleLayers(hiddenTop.layers, { width: 1, height: 1 })).toEqual([[red]]);
  });

  it('activates the newly added layer by default', () => {
    const state = createInitialLayerState(1, 1);
    const next = addLayer(state, { width: 1, height: 1 });

    expect(next.layers).toHaveLength(2);
    expect(next.activeLayerId).toBe(next.layers[1].id);
  });

  it('keeps at least one layer when removing', () => {
    const state = createInitialLayerState(1, 1);
    const next = removeLayer(state, state.layers[0].id);

    expect(next.layers).toHaveLength(1);
    expect(next.layers[0].name).toBe('图层 1');
  });

  it('renames a target layer', () => {
    const state = createInitialLayerState(1, 1);
    const next = renameLayer(state, state.layers[0].id, '线稿');

    expect(next.layers[0].name).toBe('线稿');
  });

  it('collects filled points from a layer', () => {
    const state = createInitialLayerState(2, 2);
    state.layers[0].cells[0][1] = red;
    state.layers[0].cells[1][0] = blue;

    expect(collectLayerFilledPoints(state.layers[0].cells)).toEqual([
      { x: 1, y: 0, color: red },
      { x: 0, y: 1, color: blue },
    ]);
  });
});
