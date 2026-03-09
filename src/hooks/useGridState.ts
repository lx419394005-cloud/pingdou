import { useState, useCallback, useRef } from 'react';
import type { DrawMode, GridState, GridConfig, Color, ColorPalette, GridCell, MirrorMode } from '../types';
import { resolveSelectedColorForPalette, resolveToolAction } from './gridToolState';
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
const INITIAL_CELLS = Array(DEFAULT_CONFIG.height).fill(null).map(() => Array(DEFAULT_CONFIG.width).fill(null));
const MAX_HISTORY = 50;

const cloneCells = (cells: GridCell[][]) => cells.map((row) => [...row]);
const SHAPE_TOOLS = new Set<ShapeTool>(['line', 'rectangle', 'ellipse', 'triangle']);
const isShapeTool = (tool: DrawMode): tool is ShapeTool => SHAPE_TOOLS.has(tool as ShapeTool);

export const useGridState = () => {
  const [gridState, setGridState] = useState<GridState>({
    config: DEFAULT_CONFIG,
    cells: cloneCells(INITIAL_CELLS),
    palette: null,
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
    cells: cloneCells(INITIAL_CELLS),
    palette: null,
  });

  const [historyState, setHistoryState] = useState<{
    snapshots: GridCell[][][];
    index: number;
  }>({
    snapshots: [cloneCells(INITIAL_CELLS)],
    index: 0,
  });

  const pushHistory = useCallback((cells: GridCell[][]) => {
    const snapshot = cloneCells(cells);
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
  }, []);

  const undo = useCallback(() => {
    setHistoryState((prev) => {
      if (prev.index <= 0) {
        return prev;
      }

      const nextIndex = prev.index - 1;
      const prevCells = cloneCells(prev.snapshots[nextIndex]);
      replaceGrid((current) => ({ ...current, cells: prevCells }));
      return { ...prev, index: nextIndex };
    });
  }, [replaceGrid]);

  const redo = useCallback(() => {
    setHistoryState((prev) => {
      if (prev.index >= prev.snapshots.length - 1) {
        return prev;
      }

      const nextIndex = prev.index + 1;
      const nextCells = cloneCells(prev.snapshots[nextIndex]);
      replaceGrid((current) => ({ ...current, cells: nextCells }));
      return { ...prev, index: nextIndex };
    });
  }, [replaceGrid]);

  const setResolution = useCallback((width: number, height: number) => {
    const newCells = Array(height).fill(null).map(() => Array(width).fill(null));
    replaceGrid((prev) => ({
      ...prev,
      config: { width, height },
      cells: newCells,
    }));
    setHistoryState({
      snapshots: [cloneCells(newCells)],
      index: 0,
    });
  }, [replaceGrid]);

  const setPalette = useCallback((palette: ColorPalette) => {
    replaceGrid((prev) => ({ ...prev, palette }));
    setSelectedColor((current) => resolveSelectedColorForPalette(current, palette.colors));
  }, [replaceGrid]);

  const applyPoints = useCallback((points: GridPoint[], color: GridCell) => {
    let didChange = false;
    replaceGrid((prev) => {
      const clippedPoints = clipPointsToGrid(points, prev.config);
      if (clippedPoints.length === 0) {
        return prev;
      }

      const newCells = cloneCells(prev.cells);
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

      return { ...prev, cells: newCells };
    });

    if (didChange) {
      draftChangedRef.current = true;
    }
    return didChange;
  }, [replaceGrid]);

  const commitHistoryIfChanged = useCallback(() => {
    if (draftChangedRef.current) {
      pushHistory(gridStateRef.current.cells);
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
  }, [applyPoints, commitHistoryIfChanged, drawMode, mirrorMode, resolveWorkingColor, selectedColor]);

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
  }, [applyPoints, isDrawing, mirrorMode]);

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
  }, [applyPoints, commitHistoryIfChanged, isDrawing, previewPoints]);

  const clearGrid = useCallback(() => {
    const newCells = Array(gridState.config.height).fill(null).map(() => Array(gridState.config.width).fill(null));
    replaceGrid((prev) => ({
      ...prev,
      cells: newCells,
    }));
    pushHistory(newCells);
  }, [gridState.config.height, gridState.config.width, pushHistory, replaceGrid]);

  const loadGridData = useCallback((cells: GridCell[][], config?: GridConfig) => {
    const cloned = cloneCells(cells);
    replaceGrid((prev) => ({
      ...prev,
      config: config || prev.config,
      cells: cloned,
    }));
    pushHistory(cloned);
  }, [pushHistory, replaceGrid]);

  return {
    gridState,
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
    undo,
    redo,
    canUndo: historyState.index > 0,
    canRedo: historyState.index < historyState.snapshots.length - 1,
  };
};
