import type { GridLayer, GridState } from '../types';

export interface HistorySnapshot {
  layers: GridLayer[];
  activeLayerId: string;
}

export interface HistoryState {
  snapshots: HistorySnapshot[];
  index: number;
}

const cloneCells = (cells: GridLayer['cells']) => cells.map((row) => [...row]);
const cloneLayer = (layer: GridLayer): GridLayer => ({
  ...layer,
  cells: cloneCells(layer.cells),
});

export const createHistorySnapshot = (
  layers: GridLayer[],
  activeLayerId: string,
): HistorySnapshot => ({
  layers: layers.map(cloneLayer),
  activeLayerId,
});

const areCellsEqual = (left: GridLayer['cells'], right: GridLayer['cells']) => {
  if (left.length !== right.length) {
    return false;
  }

  for (let y = 0; y < left.length; y += 1) {
    const leftRow = left[y]!;
    const rightRow = right[y];
    if (!rightRow || leftRow.length !== rightRow.length) {
      return false;
    }

    for (let x = 0; x < leftRow.length; x += 1) {
      const leftCell = leftRow[x];
      const rightCell = rightRow[x];
      if (leftCell?.hex !== rightCell?.hex) {
        return false;
      }
    }
  }

  return true;
};

export const areHistorySnapshotsEqual = (left: HistorySnapshot, right: HistorySnapshot) => {
  if (left.activeLayerId !== right.activeLayerId || left.layers.length !== right.layers.length) {
    return false;
  }

  for (let index = 0; index < left.layers.length; index += 1) {
    const leftLayer = left.layers[index]!;
    const rightLayer = right.layers[index];
    if (!rightLayer) {
      return false;
    }

    if (
      leftLayer.id !== rightLayer.id
      || leftLayer.name !== rightLayer.name
      || leftLayer.visible !== rightLayer.visible
      || !areCellsEqual(leftLayer.cells, rightLayer.cells)
    ) {
      return false;
    }
  }

  return true;
};

export const pushHistorySnapshot = (
  history: HistoryState,
  snapshot: HistorySnapshot,
  maxHistory: number,
): HistoryState => {
  const currentSnapshot = history.snapshots[history.index];
  if (currentSnapshot && areHistorySnapshotsEqual(currentSnapshot, snapshot)) {
    return history;
  }

  const snapshots = history.snapshots.slice(0, history.index + 1);
  snapshots.push(snapshot);
  if (snapshots.length > maxHistory) {
    snapshots.shift();
  }

  return {
    snapshots,
    index: snapshots.length - 1,
  };
};

export const pushGridHistorySnapshot = (
  history: HistoryState,
  gridState: Pick<GridState, 'layers' | 'activeLayerId'>,
  maxHistory: number,
): HistoryState => pushHistorySnapshot(
  history,
  createHistorySnapshot(gridState.layers, gridState.activeLayerId),
  maxHistory,
);

export const applyGridChangeWithHistory = (
  gridState: GridState,
  history: HistoryState,
  updater: (prev: GridState) => GridState,
  maxHistory: number,
) => {
  const nextGridState = updater(gridState);
  if (nextGridState === gridState) {
    return {
      gridState,
      history,
    };
  }

  return {
    gridState: nextGridState,
    history: pushGridHistorySnapshot(history, nextGridState, maxHistory),
  };
};

export const getUndoHistoryState = (history: HistoryState) => {
  if (history.index <= 0) {
    return null;
  }

  const index = history.index - 1;
  return {
    history: {
      ...history,
      index,
    },
    snapshot: history.snapshots[index]!,
  };
};

export const getRedoHistoryState = (history: HistoryState) => {
  if (history.index >= history.snapshots.length - 1) {
    return null;
  }

  const index = history.index + 1;
  return {
    history: {
      ...history,
      index,
    },
    snapshot: history.snapshots[index]!,
  };
};
