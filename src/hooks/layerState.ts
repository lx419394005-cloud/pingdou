import type { GridCell, GridConfig, GridLayer } from '../types';

export interface LayerState {
  layers: GridLayer[];
  activeLayerId: string;
}

const cloneCells = (cells: GridCell[][]) => cells.map((row) => [...row]);

const createEmptyCells = (width: number, height: number) => (
  Array(height).fill(null).map(() => Array(width).fill(null))
);

const cloneLayer = (layer: GridLayer): GridLayer => ({
  ...layer,
  cells: cloneCells(layer.cells),
});

const resolveNextLayerName = (layers: GridLayer[]) => {
  const maxIndex = layers.reduce((max, layer) => {
    const match = layer.name.match(/^图层\s+(\d+)$/);
    if (!match) {
      return max;
    }

    return Math.max(max, Number.parseInt(match[1], 10));
  }, 0);
  return `图层 ${maxIndex + 1}`;
};

export const createInitialLayerState = (width: number, height: number): LayerState => ({
  layers: [{
    id: 'layer-1',
    name: '图层 1',
    visible: true,
    cells: createEmptyCells(width, height),
  }],
  activeLayerId: 'layer-1',
});

export const composeVisibleLayers = (layers: GridLayer[], config: GridConfig): GridCell[][] => {
  const composed = createEmptyCells(config.width, config.height);

  for (const layer of layers) {
    if (!layer.visible) {
      continue;
    }

    for (let y = 0; y < config.height; y++) {
      for (let x = 0; x < config.width; x++) {
        const cell = layer.cells[y]?.[x] ?? null;
        if (cell) {
          composed[y][x] = cell;
        }
      }
    }
  }

  return composed;
};

export const collectLayerFilledPoints = (cells: GridCell[][]) => {
  const points: Array<{ x: number; y: number; color: Exclude<GridCell, null> }> = [];

  for (let y = 0; y < cells.length; y++) {
    const row = cells[y] ?? [];
    for (let x = 0; x < row.length; x++) {
      const cell = row[x];
      if (cell) {
        points.push({ x, y, color: cell });
      }
    }
  }

  return points;
};

export const getActiveLayer = (state: LayerState) => (
  state.layers.find((layer) => layer.id === state.activeLayerId) ?? state.layers[0]
);

export const addLayer = (state: LayerState, config: GridConfig): LayerState => {
  const name = resolveNextLayerName(state.layers);
  const id = `layer-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const nextLayer: GridLayer = {
    id,
    name,
    visible: true,
    cells: createEmptyCells(config.width, config.height),
  };

  return {
    layers: [...state.layers.map(cloneLayer), nextLayer],
    activeLayerId: id,
  };
};

export const setActiveLayer = (state: LayerState, layerId: string): LayerState => {
  if (!state.layers.some((layer) => layer.id === layerId)) {
    return state;
  }

  return {
    layers: state.layers.map(cloneLayer),
    activeLayerId: layerId,
  };
};

export const renameLayer = (state: LayerState, layerId: string, nextName: string): LayerState => ({
  layers: state.layers.map((layer) => (
    layer.id === layerId
      ? { ...cloneLayer(layer), name: nextName.trim() || layer.name }
      : cloneLayer(layer)
  )),
  activeLayerId: state.activeLayerId,
});

export const toggleLayerVisibility = (state: LayerState, layerId: string): LayerState => ({
  layers: state.layers.map((layer) => (
    layer.id === layerId
      ? { ...cloneLayer(layer), visible: !layer.visible }
      : cloneLayer(layer)
  )),
  activeLayerId: state.activeLayerId,
});

export const removeLayer = (state: LayerState, layerId: string): LayerState => {
  if (state.layers.length <= 1) {
    return {
      layers: state.layers.map(cloneLayer),
      activeLayerId: state.activeLayerId,
    };
  }

  const index = state.layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) {
    return {
      layers: state.layers.map(cloneLayer),
      activeLayerId: state.activeLayerId,
    };
  }

  const nextLayers = state.layers.filter((layer) => layer.id !== layerId).map(cloneLayer);
  const nextActiveLayerId = state.activeLayerId === layerId
    ? nextLayers[Math.max(0, index - 1)].id
    : state.activeLayerId;

  return {
    layers: nextLayers,
    activeLayerId: nextActiveLayerId,
  };
};

export const replaceLayerCells = (
  state: LayerState,
  layerId: string,
  cells: GridCell[][],
): LayerState => ({
  layers: state.layers.map((layer) => (
    layer.id === layerId
      ? { ...cloneLayer(layer), cells: cloneCells(cells) }
      : cloneLayer(layer)
  )),
  activeLayerId: state.activeLayerId,
});

export const setAllLayers = (layers: GridLayer[], activeLayerId: string): LayerState => ({
  layers: layers.map(cloneLayer),
  activeLayerId,
});
