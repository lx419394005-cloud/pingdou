# Multiscale Pattern Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current color-first portrait conversion with a multiscale pipeline that extracts structure from the source image, merges it into stable mosaic regions, and only then projects into a 50x50 bead pattern.

**Architecture:** Work in three stages: high-resolution feature extraction on the imported source, edge-aware region merging on an intermediate working grid, and topology-preserving projection into the final 50x50 bead grid. Palette compression happens last, after contour and feature regions are already locked.

**Tech Stack:** React 19, TypeScript, Vitest, Vite, existing canvas/ImageData pipeline

---

### Task 1: Lock the target behavior with failing multiscale tests

**Files:**
- Modify: `src/algorithms/kMeans.test.ts`
- Create: `src/algorithms/regionMosaic.test.ts`

**Step 1: Write the failing test**

Add tests for:
- preserving eye whites and glasses after intermediate region merge on portrait-like input
- keeping thin mouth / jaw contours continuous after 120x120 -> 50x50 projection
- merging shirt / skin / hair into large blocks before palette compression

Example test shape:

```ts
it('keeps eye whites as their own feature region before final palette compression', () => {
  const source = createComplexAvatarFixture(180, 180);
  const result = runMultiscalePatternPipeline(source, 50, 50, realPalette, {
    workingResolution: 120,
    targetColors: 8,
  });

  expect(countBrightEyePixels(result)).toBeGreaterThanOrEqual(2);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/algorithms/kMeans.test.ts src/algorithms/regionMosaic.test.ts`

Expected: FAIL because the new multiscale pipeline does not exist yet.

**Step 3: Commit**

```bash
git add src/algorithms/kMeans.test.ts src/algorithms/regionMosaic.test.ts
git commit -m "test: add multiscale pattern pipeline regression coverage"
```

### Task 2: Extract high-resolution feature analysis into its own module

**Files:**
- Create: `src/algorithms/featureExtraction.ts`
- Create: `src/algorithms/featureExtraction.test.ts`
- Modify: `src/algorithms/kMeans.ts`

**Step 1: Write the failing test**

Add tests for:
- contour mask detection from source-resolution image data
- bright enclosed features such as eye whites
- dark line features such as glasses, brows, mouth

Example test:

```ts
it('detects enclosed bright pockets separately from background highlights', () => {
  const source = createPortraitDetailFixture(180, 180);
  const features = extractFeatureMaps(source);

  expect(features.brightDetailMask[eyeIndex]).toBe(1);
  expect(features.brightDetailMask[backgroundIndex]).toBe(0);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/algorithms/featureExtraction.test.ts`

Expected: FAIL because `extractFeatureMaps` does not exist.

**Step 3: Write minimal implementation**

Implement:
- `extractFeatureMaps(imageData: ImageData): FeatureMaps`
- `strongEdgeMask`
- `darkDetailMask`
- `brightDetailMask`
- `featureDetailMask`
- optional `featurePriorityMask`

The output type should look like:

```ts
export interface FeatureMaps {
  width: number;
  height: number;
  strongEdges: Uint8Array;
  darkDetails: Uint8Array;
  brightDetails: Uint8Array;
  featureDetails: Uint8Array;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/algorithms/featureExtraction.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/algorithms/featureExtraction.ts src/algorithms/featureExtraction.test.ts src/algorithms/kMeans.ts
git commit -m "refactor: extract high-resolution feature maps"
```

### Task 3: Add intermediate working-grid rasterization

**Files:**
- Create: `src/algorithms/workingGrid.ts`
- Create: `src/algorithms/workingGrid.test.ts`
- Modify: `src/components/ImageProcessor/index.tsx`

**Step 1: Write the failing test**

Add tests for:
- rendering the imported crop into an intermediate `120x120` or caller-provided working grid
- preserving alpha and subject bounds after rasterization
- keeping source feature masks aligned with the working grid

Example test:

```ts
it('renders source input into a stable working grid before final projection', () => {
  const working = rasterizeWorkingGrid(sourceImageData, 120, 120);

  expect(working.imageData.width).toBe(120);
  expect(working.imageData.height).toBe(120);
  expect(working.alphaMask[0]).toBe(0);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/algorithms/workingGrid.test.ts`

Expected: FAIL because the working-grid rasterizer does not exist.

**Step 3: Write minimal implementation**

Implement:
- `rasterizeWorkingGrid(sourceImageData, width, height)`
- `renderFeatureMapsToWorkingGrid(featureMaps, width, height)`

Keep the first version deterministic and canvas-free in tests where possible.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/algorithms/workingGrid.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/algorithms/workingGrid.ts src/algorithms/workingGrid.test.ts src/components/ImageProcessor/index.tsx
git commit -m "feat: add intermediate working-grid rasterization"
```

### Task 4: Build edge-aware region mosaic merging

**Files:**
- Create: `src/algorithms/regionMosaic.ts`
- Create: `src/algorithms/regionMosaic.test.ts`

**Step 1: Write the failing test**

Add tests for:
- regions do not cross locked contour walls
- eye whites remain isolated feature regions
- large smooth areas like face / shirt merge into bigger blocks

Example test:

```ts
it('merges smooth face pixels while treating glasses and eyes as hard boundaries', () => {
  const mosaic = buildRegionMosaic(workingGrid, featureMaps, {
    mergeThreshold: 10,
  });

  expect(mosaic.regionCount).toBeLessThan(initialRegionCount);
  expect(mosaic.regionIdAt(eyeWhitePixel)).not.toBe(mosaic.regionIdAt(facePixel));
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/algorithms/regionMosaic.test.ts`

Expected: FAIL because `buildRegionMosaic` does not exist.

**Step 3: Write minimal implementation**

Implement:
- initial over-segmentation on working grid
- contour-locked adjacency graph
- iterative region merge by Lab distance, with hard barriers on locked features
- feature priority labels such as `contour`, `feature`, `region`, `background`

**Step 4: Run test to verify it passes**

Run: `npm test -- src/algorithms/regionMosaic.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/algorithms/regionMosaic.ts src/algorithms/regionMosaic.test.ts
git commit -m "feat: add edge-aware region mosaic stage"
```

### Task 5: Project the region mosaic into the 50x50 bead grid

**Files:**
- Create: `src/algorithms/gridProjection.ts`
- Create: `src/algorithms/gridProjection.test.ts`

**Step 1: Write the failing test**

Add tests for:
- contour continuity after `120x120 -> 50x50`
- eye whites keep at least one or two cells when source region survives
- region-majority fill does not leak across contour walls

Example test:

```ts
it('projects preserved feature regions into the final bead grid without breaking contour continuity', () => {
  const projected = projectMosaicToGrid(mosaic, 50, 50);

  expect(countContinuousJawRows(projected)).toBeGreaterThanOrEqual(10);
  expect(countBrightEyePixels(projected)).toBeGreaterThanOrEqual(2);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/algorithms/gridProjection.test.ts`

Expected: FAIL because `projectMosaicToGrid` does not exist.

**Step 3: Write minimal implementation**

Implement:
- weighted block voting from working grid to final grid
- contour / feature priority overrides
- tiny-gap repair after projection

**Step 4: Run test to verify it passes**

Run: `npm test -- src/algorithms/gridProjection.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/algorithms/gridProjection.ts src/algorithms/gridProjection.test.ts
git commit -m "feat: add topology-preserving grid projection"
```

### Task 6: Compress the final grid into bead palette colors last

**Files:**
- Modify: `src/algorithms/kMeans.ts`
- Modify: `src/algorithms/kMeans.test.ts`

**Step 1: Write the failing test**

Add tests for:
- palette compression runs after projection, not before
- contour and feature colors get reserved slots
- smooth regions compress aggressively without collapsing locked features

Example test:

```ts
it('compresses the final projected grid while reserving contour and feature colors', () => {
  const cells = runMultiscalePatternPipeline(source, 50, 50, realPalette, {
    targetColors: 8,
  });

  expect(countUniqueColors(cells)).toBeLessThanOrEqual(8);
  expect(countBrightEyePixels(cells)).toBeGreaterThanOrEqual(2);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/algorithms/kMeans.test.ts`

Expected: FAIL because the new pipeline is not wired into `processImageToGrid`.

**Step 3: Write minimal implementation**

Implement a new pipeline entry point, for example:

```ts
const runMultiscalePatternPipeline = (
  imageData: ImageData,
  width: number,
  height: number,
  palette: Color[],
  options?: ProcessImageOptions,
): GridCell[][] => { /* ... */ };
```

Then wire `processImageToGrid` so the preferred portrait mode uses this path instead of the current color-first cleanup path.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/algorithms/kMeans.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/algorithms/kMeans.ts src/algorithms/kMeans.test.ts
git commit -m "feat: switch portrait conversion to multiscale pipeline"
```

### Task 7: Expose working-resolution controls in the test page

**Files:**
- Modify: `src/components/ImageProcessor/index.tsx`
- Modify: `src/ImportLabPage.tsx`
- Modify: `src/types/index.ts`

**Step 1: Write the failing test**

Add tests for:
- `ProcessImageOptions` accepts working resolution
- import lab page passes working resolution through the pipeline

**Step 2: Run test to verify it fails**

Run: `npm test -- src/algorithms/kMeans.test.ts src/appEntry.test.ts`

Expected: FAIL because the UI does not yet provide the new setting.

**Step 3: Write minimal implementation**

Add:
- `workingResolution?: number`
- import-lab controls for `120 / 160 / 200`
- optional debug overlay showing intermediate mosaic

**Step 4: Run verification**

Run:
- `npm test`
- `npm run build`

Expected:
- tests pass
- build passes

**Step 5: Commit**

```bash
git add src/components/ImageProcessor/index.tsx src/ImportLabPage.tsx src/types/index.ts
git commit -m "feat: expose multiscale controls in import lab"
```

