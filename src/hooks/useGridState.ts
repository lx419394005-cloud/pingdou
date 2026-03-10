import { useState, useCallback, useRef, useMemo } from 'react';
import type {
  DrawMode,
  GridState,
  GridConfig,
  Color,
  ColorPalette,
  GridCell,
  MirrorMode,
  GridLayer,
} from '../types';
import { resolveSelectedColorForPalette, resolveToolAction } from './gridToolState';
import {
  addLayer as addLayerState,
  composeVisibleLayers,
  createInitialLayerState,
  getActiveLayer,
  removeLayer as removeLayerState,
  renameLayer as renameLayerState,
  setActiveLayer as setActiveLayerState,
  setAllLayers,
  toggleLayerVisibility as toggleLayerVisibilityState,
} from './layerState';
import {
  applyMirrorToPoints,
  clipPointsToGrid,
  getFloodFillCells,
  getMirroredPoints,
  getShapeCells,
  type GridPoint,
  type ShapeTool,
} from '../utils/pixelTools';
import { applySelectionMove, getSelectionRectPoints, translateSelectionPoints } from '../utils/selectionTools';

const DEFAULT_CONFIG: GridConfig = { width: 50, height: 50 };
const INITIAL_LAYER_STATE = createInitialLayerState(DEFAULT_CONFIG.width, DEFAULT_CONFIG.height);
const MAX_HISTORY = 50;

const cloneCells = (cells: GridCell[][]) => cells.map((row) => [...row]);
const cloneLayer = (layer: GridLayer): GridLayer => ({ ...layer, cells: cloneCells(layer.cells) });
const cloneLayers = (layers: GridLayer[]) => layers.map(cloneLayer);
const SHAPE_TOOLS = new Set<ShapeTool>(['line', 'rectangle', 'ellipse', 'triangle']);
const isShapeTool = (tool: DrawMode): tool is ShapeTool => SHAPE_TOOLS.has(tool as ShapeTool);
const pointKey = (point: GridPoint) => `${point.x},${point.y}`;
const dedupePoints = (points: GridPoint[]) => {
  const seen = new Set<string>();
  const result: GridPoint[] = [];
  for (const point of points) {
    const key = pointKey(point);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(point);
  }
  return result;
};
const getSameColorPoints = (cells: GridCell[][], colorHex: string) => {
  const points: GridPoint[] = [];
  for (let y = 0; y < cells.length; y += 1) {
    const row = cells[y];
    for (let x = 0; x < row.length; x += 1) {
      if (row[x]?.hex === colorHex) {
        points.push({ x, y });
      }
    }
  }
  return points;
};

export const useGridState = () => {
  const initialActiveLayer = getActiveLayer(INITIAL_LAYER_STATE);
  const [gridState, setGridState] = useState<GridState>({
    config: DEFAULT_CONFIG,
    cells: cloneCells(initialActiveLayer.cells),
    palette: null,
    layers: cloneLayers(INITIAL_LAYER_STATE.layers),
    activeLayerId: INITIAL_LAYER_STATE.activeLayerId,
  });
  const [selectedColor, setSelectedColor] = useState<Color | null>(null);
  const [drawMode, setDrawMode] = useState<DrawMode>('paint');
  const [mirrorMode, setMirrorMode] = useState<MirrorMode>('none');
  const [isDrawing, setIsDrawing] = useState(false);
  const [previewPoints, setPreviewPoints] = useState<GridPoint[]>([]);
  const [previewColor, setPreviewColor] = useState<GridCell>(null);
  const [selectionPoints, setSelectionPointsState] = useState<GridPoint[]>([]);
  const selectionPointsRef = useRef<GridPoint[]>([]);
  const activeStrokeRef = useRef<GridCell>(null);
  const activeToolRef = useRef<DrawMode | null>(null);
  const activeShapeRef = useRef<{ tool: ShapeTool; start: GridPoint } | null>(null);
  const activeSelectionRef = useRef<{ start: GridPoint } | null>(null);
  const activeMoveRef = useRef<{ anchor: GridPoint; sources: GridPoint[]; delta: GridPoint } | null>(null);
  const draftChangedRef = useRef(false);
  const gridStateRef = useRef<GridState>({
    config: DEFAULT_CONFIG,
    cells: cloneCells(initialActiveLayer.cells),
    palette: null,
    layers: cloneLayers(INITIAL_LAYER_STATE.layers),
    activeLayerId: INITIAL_LAYER_STATE.activeLayerId,
  });

  const [historyState, setHistoryState] = useState<{
    snapshots: Array<{ layers: GridLayer[]; activeLayerId: string }>;
    index: number;
  }>({
    snapshots: [{
      layers: cloneLayers(INITIAL_LAYER_STATE.layers),
      activeLayerId: INITIAL_LAYER_STATE.activeLayerId,
    }],
    index: 0,
  });

  const pushHistory = useCallback((layers: GridLayer[], activeLayerId: string) => {
    const snapshot = { layers: cloneLayers(layers), activeLayerId };
    setHistoryState((prev) => {
      const nextSnapshots = prev.snapshots.slice(0, prev.index + 1);
      nextSnapshots.push(snapshot);
      if (nextSnapshots.length > MAX_HISTORY) {
        nextSnapshots.shift();
      }
      return {
        snapshots: nextSnapshots,
        index: nextSnapshots.length - 1,
      };
    });
  }, []);

  const setSelectionPoints = useCallback((points: GridPoint[]) => {
    const normalized = dedupePoints(points);
    selectionPointsRef.current = normalized;
    setSelectionPointsState(normalized);
  }, []);

  const replaceGrid = useCallback((updater: (prev: GridState) => GridState) => {
    setGridState((prev) => {
      const next = updater(prev);
      gridStateRef.current = next;
      return next;
    });
  }, [setGridState]);

  const undo = useCallback(() => {
    setHistoryState((prev) => {
      if (prev.index <= 0) {
        return prev;
      }

      const nextIndex = prev.index - 1;
      const snapshot = prev.snapshots[nextIndex];
      const activeLayer = getActiveLayer(snapshot);
      replaceGrid((current) => ({
        ...current,
        layers: cloneLayers(snapshot.layers),
        activeLayerId: snapshot.activeLayerId,
        cells: cloneCells(activeLayer.cells),
      }));
      setSelectionPoints([]);
      return { ...prev, index: nextIndex };
    });
  }, [replaceGrid, setSelectionPoints]);

  const redo = useCallback(() => {
    setHistoryState((prev) => {
      if (prev.index >= prev.snapshots.length - 1) {
        return prev;
      }

      const nextIndex = prev.index + 1;
      const snapshot = prev.snapshots[nextIndex];
      const activeLayer = getActiveLayer(snapshot);
      replaceGrid((current) => ({
        ...current,
        layers: cloneLayers(snapshot.layers),
        activeLayerId: snapshot.activeLayerId,
        cells: cloneCells(activeLayer.cells),
      }));
      setSelectionPoints([]);
      return { ...prev, index: nextIndex };
    });
  }, [replaceGrid, setSelectionPoints]);

  const setResolution = useCallback((width: number, height: number) => {
    const nextLayerState = createInitialLayerState(width, height);
    const activeLayer = getActiveLayer(nextLayerState);
    replaceGrid((prev) => ({
      ...prev,
      config: { width, height },
      layers: cloneLayers(nextLayerState.layers),
      activeLayerId: nextLayerState.activeLayerId,
      cells: cloneCells(activeLayer.cells),
    }));
    setHistoryState({
      snapshots: [{
        layers: cloneLayers(nextLayerState.layers),
        activeLayerId: nextLayerState.activeLayerId,
      }],
      index: 0,
    });
    setSelectionPoints([]);
  }, [replaceGrid, setSelectionPoints]);

  const setPalette = useCallback((palette: ColorPalette) => {
    replaceGrid((prev) => ({ ...prev, palette }));
    setSelectedColor((current) => resolveSelectedColorForPalette(current, palette.colors));
  }, [replaceGrid, setSelectedColor]);

  const applyPoints = useCallback((points: GridPoint[], color: GridCell) => {
    let didChange = false;
    replaceGrid((prev) => {
      const clippedPoints = clipPointsToGrid(points, prev.config);
      if (clippedPoints.length === 0) {
        return prev;
      }

      const activeLayer = prev.layers.find((layer) => layer.id === prev.activeLayerId) ?? prev.layers[0];
      if (!activeLayer) {
        return prev;
      }

      const newCells = cloneCells(activeLayer.cells);
      for (const { x, y } of clippedPoints) {
        const currentCell = newCells[y][x];
        if (currentCell?.hex === color?.hex) {
          continue;
        }

        newCells[y][x] = color;
        didChange = true;
      }

      if (!didChange) {
        return prev;
      }

      const nextLayers = prev.layers.map((layer) => (
        layer.id === activeLayer.id
          ? { ...layer, cells: newCells }
          : layer
      ));

      return { ...prev, layers: nextLayers, cells: newCells };
    });

    if (didChange) {
      draftChangedRef.current = true;
    }
    return didChange;
  }, [replaceGrid]);

  const commitHistoryIfChanged = useCallback(() => {
    if (draftChangedRef.current) {
      pushHistory(gridStateRef.current.layers, gridStateRef.current.activeLayerId);
    }
    draftChangedRef.current = false;
  }, [pushHistory]);

  const resolveWorkingColor = useCallback(() => (
    selectedColor ?? gridStateRef.current.palette?.colors[0] ?? null
  ), [selectedColor]);

  const handleMouseDown = useCallback((x: number, y: number) => {
    const clickedCell = gridStateRef.current.cells[y]?.[x] ?? null;
    const paletteColors = gridStateRef.current.palette?.colors ?? [];

    if (drawMode === 'select') {
      const start = { x, y };
      activeToolRef.current = 'select';
      activeSelectionRef.current = { start };
      activeShapeRef.current = null;
      activeMoveRef.current = null;
      draftChangedRef.current = false;
      setPreviewColor(null);
      setPreviewPoints(getSelectionRectPoints(start, start, gridStateRef.current.config));
      setIsDrawing(true);
      return;
    }

    if (drawMode === 'move') {
      const sources = selectionPointsRef.current;
      if (sources.length === 0) {
        return;
      }

      const sourceSet = new Set(sources.map(pointKey));
      if (!sourceSet.has(pointKey({ x, y }))) {
        return;
      }

      activeToolRef.current = 'move';
      activeSelectionRef.current = null;
      activeShapeRef.current = null;
      activeMoveRef.current = {
        anchor: { x, y },
        sources,
        delta: { x: 0, y: 0 },
      };
      draftChangedRef.current = false;
      setPreviewColor(null);
      setPreviewPoints(sources);
      setIsDrawing(true);
      return;
    }

    if (drawMode === 'select-color') {
      const target = gridStateRef.current.cells[y]?.[x] ?? null;
      if (!target) {
        setSelectionPoints([]);
        setPreviewPoints([]);
        setPreviewColor(null);
        return;
      }

      setSelectionPoints(getSameColorPoints(gridStateRef.current.cells, target.hex));
      setSelectedColor(target);
      setPreviewPoints([]);
      setPreviewColor(null);
      return;
    }

    if (drawMode === 'fill') {
      const fillColor = resolveWorkingColor();
      if (!fillColor) {
        return;
      }

      const starts = getMirroredPoints({ x, y }, gridStateRef.current.config, mirrorMode);
      const points = starts.flatMap((point) => getFloodFillCells(gridStateRef.current.cells, point, fillColor));
      draftChangedRef.current = false;
      applyPoints(points, fillColor);
      commitHistoryIfChanged();
      setSelectedColor(fillColor);
      return;
    }

    if (isShapeTool(drawMode)) {
      const strokeColor = resolveWorkingColor();
      if (!strokeColor) {
        return;
      }

      const start = { x, y };
      const initialPreview = applyMirrorToPoints(
        getShapeCells(drawMode, start, start),
        gridStateRef.current.config,
        mirrorMode,
      );

      activeToolRef.current = drawMode;
      activeShapeRef.current = { tool: drawMode, start };
      activeStrokeRef.current = strokeColor;
      draftChangedRef.current = false;
      setPreviewPoints(initialPreview);
      setPreviewColor(strokeColor);
      setSelectedColor(strokeColor);
      setIsDrawing(true);
      return;
    }

    const action = resolveToolAction({
      drawMode,
      selectedColor,
      clickedCell,
      paletteColors,
    });

    if (action.nextSelectedColor && action.nextSelectedColor.hex !== selectedColor?.hex) {
      setSelectedColor(action.nextSelectedColor);
    }

    if (action.nextDrawMode && action.nextDrawMode !== drawMode) {
      setDrawMode(action.nextDrawMode);
    }

    if (!action.shouldDraw) {
      return;
    }

    activeStrokeRef.current = action.strokeColor;
    activeToolRef.current = drawMode;
    draftChangedRef.current = false;
    setIsDrawing(true);
    applyPoints(
      getMirroredPoints({ x, y }, gridStateRef.current.config, mirrorMode),
      action.strokeColor,
    );
  }, [
    applyPoints,
    commitHistoryIfChanged,
    drawMode,
    mirrorMode,
    resolveWorkingColor,
    selectedColor,
    setDrawMode,
    setIsDrawing,
    setPreviewColor,
    setPreviewPoints,
    setSelectedColor,
  ]);

  const handleMouseEnter = useCallback((x: number, y: number) => {
    if (!isDrawing) {
      return;
    }

    const activeTool = activeToolRef.current;
    if (activeTool === 'select' && activeSelectionRef.current) {
      const nextPreview = getSelectionRectPoints(
        activeSelectionRef.current.start,
        { x, y },
        gridStateRef.current.config,
      );
      setPreviewPoints(nextPreview);
      return;
    }

    if (activeTool === 'move' && activeMoveRef.current) {
      const delta = {
        x: x - activeMoveRef.current.anchor.x,
        y: y - activeMoveRef.current.anchor.y,
      };
      activeMoveRef.current.delta = delta;
      setPreviewPoints(
        translateSelectionPoints(
          activeMoveRef.current.sources,
          delta,
          gridStateRef.current.config,
        ),
      );
      return;
    }

    if (activeTool && isShapeTool(activeTool) && activeShapeRef.current) {
      const nextPreview = applyMirrorToPoints(
        getShapeCells(activeTool, activeShapeRef.current.start, { x, y }),
        gridStateRef.current.config,
        mirrorMode,
      );
      setPreviewPoints(nextPreview);
      return;
    }

    applyPoints(
      getMirroredPoints({ x, y }, gridStateRef.current.config, mirrorMode),
      activeStrokeRef.current,
    );
  }, [applyPoints, isDrawing, mirrorMode, setPreviewPoints]);

  const handleMouseUp = useCallback(() => {
    if (!isDrawing) {
      return;
    }

    const activeTool = activeToolRef.current;
    if (activeTool === 'select') {
      setSelectionPoints(previewPoints);
      setIsDrawing(false);
      setPreviewPoints([]);
      setPreviewColor(null);
      activeStrokeRef.current = null;
      activeToolRef.current = null;
      activeShapeRef.current = null;
      activeSelectionRef.current = null;
      activeMoveRef.current = null;
      return;
    }

    if (activeTool === 'move' && activeMoveRef.current) {
      const moveResult = applySelectionMove(
        gridStateRef.current.cells,
        activeMoveRef.current.sources,
        activeMoveRef.current.delta,
        gridStateRef.current.config,
      );

      if (moveResult.changed) {
        replaceGrid((prev) => {
          const activeLayer = prev.layers.find((layer) => layer.id === prev.activeLayerId) ?? prev.layers[0];
          if (!activeLayer) {
            return prev;
          }

          const nextLayers = prev.layers.map((layer) => (
            layer.id === activeLayer.id
              ? { ...layer, cells: cloneCells(moveResult.cells) }
              : layer
          ));

          draftChangedRef.current = true;
          return { ...prev, layers: nextLayers, cells: cloneCells(moveResult.cells) };
        });
      }

      setSelectionPoints(moveResult.selection);
      commitHistoryIfChanged();
      setIsDrawing(false);
      setPreviewPoints([]);
      setPreviewColor(null);
      activeStrokeRef.current = null;
      activeToolRef.current = null;
      activeShapeRef.current = null;
      activeSelectionRef.current = null;
      activeMoveRef.current = null;
      return;
    }

    if (activeShapeRef.current) {
      applyPoints(previewPoints, activeStrokeRef.current);
    }
    commitHistoryIfChanged();
    setIsDrawing(false);
    setPreviewPoints([]);
    setPreviewColor(null);
    activeStrokeRef.current = null;
    activeToolRef.current = null;
    activeShapeRef.current = null;
    activeSelectionRef.current = null;
    activeMoveRef.current = null;
  }, [applyPoints, commitHistoryIfChanged, isDrawing, previewPoints, replaceGrid, setIsDrawing, setPreviewColor, setPreviewPoints, setSelectionPoints]);

  const clearGrid = useCallback(() => {
    const newCells = Array(gridState.config.height).fill(null).map(() => Array(gridState.config.width).fill(null));
    replaceGrid((prev) => ({
      ...prev,
      layers: prev.layers.map((layer) => (
        layer.id === prev.activeLayerId ? { ...layer, cells: cloneCells(newCells) } : layer
      )),
      cells: newCells,
    }));
    pushHistory(gridStateRef.current.layers, gridStateRef.current.activeLayerId);
    setSelectionPoints([]);
  }, [gridState.config.height, gridState.config.width, pushHistory, replaceGrid, setSelectionPoints]);

  const loadGridData = useCallback((cells: GridCell[][], config?: GridConfig) => {
    const cloned = cloneCells(cells);
    const nextConfig = config || gridStateRef.current.config;
    const nextLayerState = createInitialLayerState(nextConfig.width, nextConfig.height);
    nextLayerState.layers[0].cells = cloneCells(cloned);
    replaceGrid((prev) => ({
      ...prev,
      config: nextConfig,
      layers: cloneLayers(nextLayerState.layers),
      activeLayerId: nextLayerState.activeLayerId,
      cells: cloned,
    }));
    pushHistory(nextLayerState.layers, nextLayerState.activeLayerId);
    setSelectionPoints([]);
  }, [pushHistory, replaceGrid, setSelectionPoints]);

  const addLayer = useCallback(() => {
    replaceGrid((prev) => {
      const nextLayerState = addLayerState(
        setAllLayers(prev.layers, prev.activeLayerId),
        prev.config,
      );
      const activeLayer = getActiveLayer(nextLayerState);
      return {
        ...prev,
        layers: cloneLayers(nextLayerState.layers),
        activeLayerId: nextLayerState.activeLayerId,
        cells: cloneCells(activeLayer.cells),
      };
    });
    pushHistory(gridStateRef.current.layers, gridStateRef.current.activeLayerId);
  }, [pushHistory, replaceGrid]);

  const setActiveLayer = useCallback((layerId: string) => {
    replaceGrid((prev) => {
      const nextLayerState = setActiveLayerState(setAllLayers(prev.layers, prev.activeLayerId), layerId);
      const activeLayer = getActiveLayer(nextLayerState);
      return {
        ...prev,
        layers: cloneLayers(nextLayerState.layers),
        activeLayerId: nextLayerState.activeLayerId,
        cells: cloneCells(activeLayer.cells),
      };
    });
    setSelectionPoints([]);
  }, [replaceGrid, setSelectionPoints]);

  const toggleLayerVisibility = useCallback((layerId: string) => {
    replaceGrid((prev) => {
      const nextLayerState = toggleLayerVisibilityState(setAllLayers(prev.layers, prev.activeLayerId), layerId);
      const activeLayer = getActiveLayer(nextLayerState);
      return {
        ...prev,
        layers: cloneLayers(nextLayerState.layers),
        activeLayerId: nextLayerState.activeLayerId,
        cells: cloneCells(activeLayer.cells),
      };
    });
    pushHistory(gridStateRef.current.layers, gridStateRef.current.activeLayerId);
  }, [pushHistory, replaceGrid]);

  const renameLayer = useCallback((layerId: string, name: string) => {
    replaceGrid((prev) => {
      const nextLayerState = renameLayerState(setAllLayers(prev.layers, prev.activeLayerId), layerId, name);
      const activeLayer = getActiveLayer(nextLayerState);
      return {
        ...prev,
        layers: cloneLayers(nextLayerState.layers),
        activeLayerId: nextLayerState.activeLayerId,
        cells: cloneCells(activeLayer.cells),
      };
    });
  }, [replaceGrid]);

  const removeLayer = useCallback((layerId: string) => {
    replaceGrid((prev) => {
      const nextLayerState = removeLayerState(setAllLayers(prev.layers, prev.activeLayerId), layerId);
      const activeLayer = getActiveLayer(nextLayerState);
      return {
        ...prev,
        layers: cloneLayers(nextLayerState.layers),
        activeLayerId: nextLayerState.activeLayerId,
        cells: cloneCells(activeLayer.cells),
      };
    });
    pushHistory(gridStateRef.current.layers, gridStateRef.current.activeLayerId);
    setSelectionPoints([]);
  }, [pushHistory, replaceGrid, setSelectionPoints]);

  const composedCells = useMemo(
    () => composeVisibleLayers(gridState.layers, gridState.config),
    [gridState.config, gridState.layers],
  );

  return {
    gridState,
    composedCells,
    selectedColor,
    setSelectedColor,
    drawMode,
    setDrawMode,
    setResolution,
    setPalette,
    mirrorMode,
    setMirrorMode,
    handleMouseDown,
    handleMouseEnter,
    handleMouseUp,
    previewPoints,
    previewColor,
    selectionPoints,
    clearGrid,
    loadGridData,
    addLayer,
    setActiveLayer,
    toggleLayerVisibility,
    renameLayer,
    removeLayer,
    undo,
    redo,
    canUndo: historyState.index > 0,
    canRedo: historyState.index < historyState.snapshots.length - 1,
  };
};
