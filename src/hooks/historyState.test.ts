import { describe, expect, it } from 'vitest';
import {
  applyGridChangeWithHistory,
  areHistorySnapshotsEqual,
  createHistorySnapshot,
  getRedoHistoryState,
  getUndoHistoryState,
  pushHistorySnapshot,
  type HistoryState,
} from './historyState';
import type { Color, GridState } from '../types';

const createSnapshot = (activeLayerId: string) => ({
  layers: [{
    id: activeLayerId,
    name: activeLayerId,
    visible: true,
    cells: [[null]],
  }],
  activeLayerId,
});

const createColor = (hex: string): Color => ({
  name: hex,
  hex,
  rgb: { r: 0, g: 0, b: 0 },
});

const paintCell = (gridState: GridState, x: number, y: number, color: Color): GridState => {
  const activeLayer = gridState.layers.find((layer) => layer.id === gridState.activeLayerId) ?? gridState.layers[0]!;
  const nextCells = activeLayer.cells.map((row) => [...row]);
  nextCells[y]![x] = color;
  const nextLayers = gridState.layers.map((layer) => (
    layer.id === activeLayer.id
      ? { ...layer, cells: nextCells }
      : { ...layer, cells: layer.cells.map((row) => [...row]) }
  ));

  return {
    ...gridState,
    layers: nextLayers,
    cells: nextCells,
  };
};

describe('historyState', () => {
  it('undo only moves back by one snapshot', () => {
    const history: HistoryState = {
      snapshots: [
        createSnapshot('layer-1'),
        createSnapshot('layer-2'),
        createSnapshot('layer-3'),
      ],
      index: 2,
    };

    const result = getUndoHistoryState(history);

    expect(result?.history.index).toBe(1);
    expect(result?.snapshot.activeLayerId).toBe('layer-2');
  });

  it('redo only moves forward by one snapshot', () => {
    const history: HistoryState = {
      snapshots: [
        createSnapshot('layer-1'),
        createSnapshot('layer-2'),
        createSnapshot('layer-3'),
      ],
      index: 0,
    };

    const result = getRedoHistoryState(history);

    expect(result?.history.index).toBe(1);
    expect(result?.snapshot.activeLayerId).toBe('layer-2');
  });

  it('drops redo branch when a new snapshot is pushed after undo', () => {
    const history: HistoryState = {
      snapshots: [
        createSnapshot('layer-1'),
        createSnapshot('layer-2'),
        createSnapshot('layer-3'),
      ],
      index: 1,
    };

    const next = pushHistorySnapshot(history, createSnapshot('layer-4'), 10);

    expect(next.index).toBe(2);
    expect(next.snapshots.map((snapshot) => snapshot.activeLayerId)).toEqual(['layer-1', 'layer-2', 'layer-4']);
  });

  it('does not append duplicate snapshots for the same state', () => {
    const history: HistoryState = {
      snapshots: [createSnapshot('layer-1')],
      index: 0,
    };

    const next = pushHistorySnapshot(history, createSnapshot('layer-1'), 10);

    expect(next).toBe(history);
    expect(next.snapshots).toHaveLength(1);
  });

  it('treats layer metadata changes as distinct history snapshots', () => {
    const base = createSnapshot('layer-1');
    const renamed = {
      ...createSnapshot('layer-1'),
      layers: [{ ...createSnapshot('layer-1').layers[0]!, name: '新图层名' }],
    };

    expect(areHistorySnapshotsEqual(base, renamed)).toBe(false);
  });

  it('stores each committed result so undo only steps back one change', () => {
    const baseGridState: GridState = {
      config: { width: 2, height: 2 },
      cells: [
        [null, null],
        [null, null],
      ],
      palette: null,
      layers: [{
        id: 'layer-1',
        name: '图层 1',
        visible: true,
        cells: [
          [null, null],
          [null, null],
        ],
      }],
      activeLayerId: 'layer-1',
    };
    const baseHistory: HistoryState = {
      snapshots: [createHistorySnapshot(baseGridState.layers, baseGridState.activeLayerId)],
      index: 0,
    };

    const first = applyGridChangeWithHistory(
      baseGridState,
      baseHistory,
      (current) => paintCell(current, 0, 0, createColor('#111111')),
      10,
    );
    const second = applyGridChangeWithHistory(
      first.gridState,
      first.history,
      (current) => paintCell(current, 1, 0, createColor('#222222')),
      10,
    );
    const undo = getUndoHistoryState(second.history);

    expect(undo?.snapshot.layers[0]?.cells).toEqual([
      [createColor('#111111'), null],
      [null, null],
    ]);
  });
});
