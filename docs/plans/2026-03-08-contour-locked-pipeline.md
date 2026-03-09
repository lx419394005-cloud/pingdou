# Contour Locked Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the default bead conversion algorithm with a contour-first pipeline that locks line topology before any region color merging.

**Architecture:** Render the cropped image at a higher resolution for contour extraction, downsample the extracted contour into a locked 50x50 contour grid, then perform flood-fill region grouping and color merging only on non-contour cells. The locked contour cells are never remapped during palette reduction.

**Tech Stack:** React, TypeScript, Vitest, Vite

---

### Task 1: Add failing contour-lock tests

**Files:**
- Modify: `src/algorithms/kMeans.test.ts`

**Step 1: Write the failing test**

Add tests for:
- high-resolution contour extraction preserving a thin mouth line after downsampling
- contour-locked processing preserving contour topology while reducing the full grid to 6 colors or fewer

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL because the current algorithm does not use a high-resolution contour source and does not guarantee locked contour topology.

### Task 2: Add contour-source input to processing

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/algorithms/kMeans.ts`

**Step 1: Write minimal implementation**

Add `contourImageData?: ImageData` to processing options and introduce helpers for:
- high-resolution contour mask extraction
- contour mask downsampling into a 50x50 locked contour grid
- contour continuity repair for single-cell gaps

**Step 2: Run tests**

Run: `npm test`

Expected: the new contour extraction tests pass while existing tests remain green.

### Task 3: Replace legacy-guided pipeline with contour-locked region merge

**Files:**
- Modify: `src/algorithms/kMeans.ts`

**Step 1: Write minimal implementation**

Implement:
- contour-locked mask
- region flood fill that treats contour cells as walls
- region palette merging only on non-contour cells
- final palette compression that excludes contour cells from recoloring

**Step 2: Run tests**

Run: `npm test`

Expected: all algorithm tests pass, including the 6-color constraint.

### Task 4: Update UI to use contour-locked mode by default

**Files:**
- Modify: `src/components/ImageProcessor/index.tsx`
- Modify: `src/types/index.ts`

**Step 1: Write minimal implementation**

Render a high-resolution offscreen crop for contour extraction, pass it into `processImageToGrid`, and rename the recommended mode label to `Contour Locked`.

**Step 2: Run verification**

Run:
- `npm test`
- `npm run build`
- `npm run lint`

Expected:
- tests pass
- production build passes
- lint has no new errors
