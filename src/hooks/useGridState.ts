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

const DEFAULT_CONFIG: GridConfig = { width: 50, height: 50 };
const INITIAL_LAYER_STATE = createInitialLayerState(DEFAULT_CONFIG.width, DEFAULT_CONFIG.height);
const MAX_HISTORY = 50;

const cloneCells = (cells: GridCell[][]) => cells.map((row) => [...row]);
const cloneLayer = (layer: GridLayer): GridLayer => ({ ...layer, cells: cloneCells(layer.cells) });
const cloneLayers = (layers: GridLayer[]) => layers.map(cloneLayer);
const SHAPE_TOOLS = new Set<ShapeTool>(['line', 'rectangle', 'ellipse', 'triangle']);
const isShapeTool = (tool: DrawMode): tool is ShapeTool => SHAPE_TOOLS.has(tool as ShapeTool);

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
  const activeStrokeRef = useRef<GridCell>(null);
  const activeToolRef = useRef<DrawMode | null>(null);
  const activeShapeRef = useRef<{ tool: ShapeTool; start: GridPoint } | null>(null);
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
      return { ...prev, index: nextIndex };
    });
  }, [replaceGrid]);

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
      return { ...prev, index: nextIndex };
    });
  }, [replaceGrid]);

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
  }, [replaceGrid]);

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
    if (isDrawing) {
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
    }
  }, [applyPoints, commitHistoryIfChanged, isDrawing, previewPoints, setIsDrawing, setPreviewColor, setPreviewPoints]);

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
  }, [gridState.config.height, gridState.config.width, pushHistory, replaceGrid]);

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
  }, [pushHistory, replaceGrid]);

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
  }, [replaceGrid]);

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
  }, [pushHistory, replaceGrid]);

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
