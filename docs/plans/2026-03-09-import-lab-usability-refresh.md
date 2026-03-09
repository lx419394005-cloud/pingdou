# Import Lab 易用性重构 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把当前 Import Lab 重构成一个更简单易用的 50x50 拼豆编辑工作台，重点完善导入、描边编辑、叠图辅助和标号导出。

**Architecture:** 保留现有三栏布局，但把状态和职责重新划分为 `导入源图`、`50x50 叠图编辑`、`图纸预览/导出` 三个清晰工作区。导入链路从 `ImageProcessor` 中拆出为更轻的“源图载入 + 裁切对齐 + 工作图生成”流程，编辑区则围绕固定 50x50 叠图画布建立单一操作上下文，最后让编号/图例体系统一复用同一套颜色编码与渲染规则。

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Tailwind CSS, Canvas 2D

---

### Task 1: 锁定新的编辑工作流与数据模型

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/hooks/useGridState.ts`
- Modify: `src/hooks/gridToolState.ts`
- Test: `src/hooks/gridToolState.test.ts`
- Test: `src/hooks/useGridState.ts` (新增测试文件或补现有覆盖)

**Step 1: Write the failing test**

补测试覆盖：
- 固定 50x50 工作台下导入图层与拼豆单元格可以独立存在
- 工具切换时仍保持当前选色和镜像模式
- 叠图描边预览不会污染最终 cells，只有 mouse up 才提交
- 后续支持“编号样式切换”时，状态层能提供统一 label metadata

**Step 2: Run test to verify it fails**

Run: `npm test -- src/hooks/gridToolState.test.ts`

Expected: FAIL，因为当前状态层还没有导入图层/标号样式这些概念。

**Step 3: Write minimal implementation**

新增或整理：
- `editorOverlay` / `referenceImage` / `referenceTransform` 一类状态
- `activeTool`, `labelMode`, `previewStroke` 等编辑态
- 更明确的 action helper，避免 `ImageProcessor` 和 `GridEditor` 各自维护一部分真相

**Step 4: Run tests**

Run: `npm test -- src/hooks/gridToolState.test.ts`

Expected: PASS

### Task 2: 精简图片导入链路，拆出“导入 -> 对齐 -> 生成”流程

**Files:**
- Modify: `src/components/ImageProcessor/index.tsx`
- Create: `src/components/ImageProcessor/ImportSourcePanel.tsx`
- Create: `src/components/ImageProcessor/OverlayAlignPanel.tsx`
- Modify: `src/utils/imageProcessing.ts`
- Test: `src/utils/imageProcessing.test.ts`

**Step 1: Write the failing test**

补测试覆盖：
- 源图导入后能产出单一 reference image，而不是同时维护多份冗余预览
- 对齐后的导出图层尺寸稳定映射到 50x50 目标网格
- 自动裁边、主体 bounds、叠图参考图使用同一套 transform

**Step 2: Run test to verify it fails**

Run: `npm test -- src/utils/imageProcessing.test.ts`

Expected: FAIL，因为当前预览图、处理图、叠图图层是分散生成的。

**Step 3: Write minimal implementation**

重构 `ImageProcessor`：
- 把文件选择、推荐参数、裁切预览拆成子组件
- 统一输出 `referenceImage + transform + generatedCells`
- 减少 `previewCanvasRef / processingCanvasRef / contourCanvasRef` 之间重复职责
- 保留现有算法入口，但把 UI 层改成更容易理解的“1. 导入 2. 对齐 3. 生成”

**Step 4: Run verification**

Run:
- `npm test -- src/utils/imageProcessing.test.ts`
- `npm run build`

Expected:
- 测试通过
- 构建通过

### Task 3: 重构中央编辑区为“参考图叠层 + 50x50 描边编辑器”

**Files:**
- Modify: `src/components/GridEditor/index.tsx`
- Modify: `src/utils/patternCanvas.ts`
- Modify: `src/utils/gridZoom.ts`
- Test: `src/utils/patternCanvas.test.ts`

**Step 1: Write the failing test**

补测试覆盖：
- 50x50 画布叠在原图上时，网格线、主刻度线、编号层位置一致
- `overlay` 模式下参考图透明度和单元格编号可同时展示
- 新的工具按钮数据结构支持 icon、label、tooltip、active state

**Step 2: Run test to verify it fails**

Run: `npm test -- src/utils/patternCanvas.test.ts`

Expected: FAIL，因为当前编辑器只支持文字按钮和基础叠图渲染。

**Step 3: Write minimal implementation**

实现：
- 左侧竖向工具栏，给画笔、橡皮、吸管、油漆桶、直线、矩形、椭圆等加入 icon
- 中央固定“参考原图 + 50x50 网格 + 当前描边预览”的叠层渲染
- 更清晰的顶部视图切换：`叠图描边 / 彩色图 / 标号图`
- 在 `overlay` 模式里强化描边用途，而不是只做透明度展示

**Step 4: Run verification**

Run:
- `npm test -- src/utils/patternCanvas.test.ts`
- `npm run build`

Expected:
- 测试通过
- 构建通过

### Task 4: 统一编号体系，支持颜色块 + 字母前缀编码

**Files:**
- Modify: `src/utils/pattern.ts`
- Modify: `src/utils/patternCanvas.ts`
- Modify: `src/components/GridEditor/index.tsx`
- Modify: `src/components/ExportPanel/index.tsx`
- Test: `src/utils/pattern.test.ts`

**Step 1: Write the failing test**

补测试覆盖：
- 每个颜色除了数量统计，还能生成稳定的显示编号，如 `H7`、`C10`、`B29`
- 图纸标号视图与导出图例使用相同编码，不出现编辑区和导出区不一致
- 深浅底色下文字前景色自动切换，保证可读性

**Step 2: Run test to verify it fails**

Run: `npm test -- src/utils/pattern.test.ts src/utils/patternCanvas.test.ts`

Expected: FAIL，因为当前编码仍是纯数字。

**Step 3: Write minimal implementation**

实现：
- `IndexedPaletteEntry` 增加 `displayCode` / `familyPrefix` 一类字段
- 允许按色卡名、颜色家族或自定义规则生成类似 Mard 的编号
- 编号视图直接用彩色底块 + 字母前缀编码，而不是白底纯数字
- 图例同步展示 `displayCode + 色名 + HEX + 数量`

**Step 4: Run verification**

Run:
- `npm test -- src/utils/pattern.test.ts src/utils/patternCanvas.test.ts`
- `npm run build`

Expected:
- 测试通过
- 构建通过

### Task 5: 收敛页面结构，突出“导入、编辑、预览导出”三段式流程

**Files:**
- Modify: `src/ImportLabPage.tsx`
- Modify: `src/components/ExportPanel/index.tsx`
- Modify: `src/index.css`

**Step 1: Write the failing test**

如果补 UI 快照测试成本过高，则至少补一条集成覆盖：
- `import-lab` 页面载入后，左栏是导入源图，中栏是编辑器，右栏是预览与导出
- 编辑器上方存在明确的当前模式、透明度、标号视图控制

**Step 2: Write minimal implementation**

实现：
- 左栏只保留导入相关和色卡相关
- 中栏变成真正的主工作区，优先展示画布与工具
- 右栏聚焦参考预览、颜色图例、导出按钮
- 文案统一为“适合快速照着描边修图”的工作流表述

**Step 3: Run full verification**

Run:
- `npm test`
- `npm run build`
- `npm run lint`

Expected:
- 全部测试通过
- 构建通过
- lint 没有新增错误

---

## Proposed Page Structure

```text
+------------------------------------------------------------------------------------------------------+
| Header: Import Lab | 当前参考图 | 生成模式 | 拼豆数 | 颜色数 | 工作分辨率 | 返回主工作台              |
+-------------------------------+------------------------------------------------+-----------------------------+
| Left Rail                     | Center Stage                                   | Right Rail                  |
| 导入 / 参数 / 色卡            | 50x50 编辑主画布                               | 参考 / 预览 / 导出          |
|                               |                                                |                             |
| [导入图片]                    | [模式栏] 叠图描边 | 彩色图 | 标号图            | [导入裁切预览]              |
| 文件名                        | [透明度] ----o----                              | [编号预览缩略图]            |
| 自动裁边 开/关                |                                                |                             |
| 主体对齐                      |  [工具栏]   [原图参考层]                        | [颜色图例]                  |
| 工作分辨率 120/160/200        |  [画笔icon] [50x50 网格层]                      | H7  黑      318             |
| 算法模式                      |  [橡皮icon] [描边预览层]                        | C10 浅蓝     294            |
| 目标颜色数                    |  [吸管icon] [选中单元高亮]                      | B29 黄绿      96            |
|                               |  [直线icon]                                     | ...                         |
| [色卡列表]                    |                                                |                             |
| 选中色 / 搜索 / 切换色卡       | [底部状态条] 当前工具 | 当前颜色 | 镜像模式     | [导出按钮组]                |
|                               |                                                | 导出彩色图                  |
|                               |                                                | 导出标号图                  |
|                               |                                                | 导出叠图图纸                |
|                               |                                                | 导出 CSV / JSON             |
+-------------------------------+------------------------------------------------+-----------------------------+
```

## Notes

- 推荐优先走这个方案，不建议再往 `ImageProcessor` 里继续堆状态；当前组件已经同时承担导入、裁切、预览、处理和状态广播，后续会越来越难维护。
- `标号图` 建议直接对齐你给的参考图风格：彩色底块 + `字母前缀 + 数字`，这样用户在屏幕预览时就已经接近最终图纸，不需要脑内再做一次转换。
- `叠图` 不建议再把原图和成品图分成两个地方看，最顺手的做法就是在同一主画布上把 50x50 网格压到参考图上，专门服务“描边修轮廓”这个动作。
