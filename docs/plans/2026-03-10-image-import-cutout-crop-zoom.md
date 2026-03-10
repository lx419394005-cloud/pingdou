# Image Import Cutout/Crop/Zoom Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve the import modal with smoother zoom slider behavior, add cutout tools (auto + line selection), and add explicit crop apply action.

**Architecture:** Keep all pixel operations in utility functions (`src/utils/imageProcessing.ts`) and keep `ImageProcessor` as orchestration + UI interaction layer. Reuse the existing preview canvas and rendering pipeline; add mode-based pointer behavior for move vs lasso cutout.

**Tech Stack:** React 19, TypeScript, Vitest, HTML Canvas APIs.

---

### Task 1: Add failing tests for new image-edit behaviors

**Files:**
- Modify: `src/utils/imageProcessing.test.ts`

**Step 1: Write failing tests for smooth zoom mapping utility behavior**
**Step 2: Write failing tests for edge-color auto cutout behavior**
**Step 3: Write failing tests for polygon line-selection cutout behavior**
**Step 4: Write failing tests for crop source-rect calculation**
**Step 5: Run `npm test -- src/utils/imageProcessing.test.ts` and confirm failure**

### Task 2: Implement utility functions to satisfy tests

**Files:**
- Modify: `src/utils/imageProcessing.ts`

**Step 1: Add zoom slider mapping helpers**
**Step 2: Add edge-connected background cutout helper**
**Step 3: Add polygon (line-selection) cutout helper**
**Step 4: Add crop source-rect helper**
**Step 5: Run `npm test -- src/utils/imageProcessing.test.ts` and confirm pass**

### Task 3: Wire new features into image import modal

**Files:**
- Modify: `src/components/ImageProcessor/index.tsx`

**Step 1: Replace current linear zoom slider with normalized slider + mapped scale**
**Step 2: Add cutout mode UI (auto cutout + line-selection keep/remove)**
**Step 3: Add explicit “apply crop” action**
**Step 4: Keep existing generation flow unchanged**
**Step 5: Run targeted tests and full `npm test`**
