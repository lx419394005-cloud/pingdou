# Adjustable Color Limit UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a UI control for target color count with an Auto default derived from the imported image's color distribution, while keeping `legacy-nearest` behavior unchanged.

**Architecture:** Extend `ProcessImageOptions` with a configurable `targetColors` value for compression-based modes, and add a recommendation helper that estimates a low-but-stable default from coarse color distribution plus edge complexity. The Image Import panel will expose `Auto` and manual color-limit controls and pass the resolved limit into `processImageToGrid`.

**Tech Stack:** React, TypeScript, Vitest, Vite

---

### Task 1: Add failing tests for color-limit recommendation and algorithm overrides

**Files:**
- Modify: `src/algorithms/kMeans.test.ts`

**Step 1: Write the failing test**

Add tests for:
- `estimateRecommendedColorLimit` returning a lower recommendation for flat-color anime-style input than for a more varied input
- `legacy-clean` honoring a caller-provided `targetColors` override

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL because no recommendation helper or `targetColors` override exists yet.

### Task 2: Implement configurable target color budget in the algorithm pipeline

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/algorithms/kMeans.ts`

**Step 1: Write minimal implementation**

Add:
- `targetColors?: number` to `ProcessImageOptions`
- a clamp helper for supported color budgets
- `estimateRecommendedColorLimit(imageData)` helper
- dynamic target color support in `legacy-clean` and `legacy-guided`

**Step 2: Run tests**

Run: `npm test`

Expected: the new tests pass and existing algorithm tests stay green.

### Task 3: Add UI controls for Auto/manual target color count

**Files:**
- Modify: `src/components/ImageProcessor/index.tsx`

**Step 1: Write minimal implementation**

Add:
- Auto/manual mode toggle for target colors
- a numeric/range control for manual color count
- automatic recommendation refresh when a new image is loaded
- resolved `targetColors` passed into `processImageToGrid`

**Step 2: Run verification**

Run:
- `npm test`
- `npm run build`
- `npm run lint`

Expected:
- tests pass
- build passes
- lint has no new errors
