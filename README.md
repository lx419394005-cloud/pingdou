# Pingdou

中文 | [English](#english)

`Pingdou` 是一个基于 React + TypeScript + Vite 的拼豆图纸工作台。它把参考图导入、主体裁切、颜色量化、50x50 网格编辑和图纸导出整合到一个浏览器界面里，适合快速生成和手工修正拼豆方案。

## 中文

### 当前功能

- 导入参考图片，并自动去除连通白底
- 在导入窗口中拖拽、缩放主体，生成 50x50 拼豆网格
- 使用内置 `Mard` 色卡进行颜色匹配
- 在编辑器中进行画笔、橡皮、吸管、油漆桶、直线、矩形、椭圆、三角形等操作
- 支持像素视图、标号视图、叠图视图
- 支持镜像绘制、撤销/重做、颜色搜索
- 导出像素图纸、标号图纸、叠图图纸、用量 CSV、工程 JSON

### 技术栈

- React 19
- TypeScript 5
- Vite 7
- Tailwind CSS 4
- Vitest

### 快速开始

```bash
npm install
npm run dev
```

默认开发地址通常是 `http://localhost:5173`。

### 可用脚本

```bash
npm run dev
npm run build
npm run lint
npm test
```

### 使用流程

1. 打开应用后，点击左上或参考图区导入图片。
2. 在导入窗口中拖动和缩放主体，选择算法模式与目标颜色数。
3. 生成图纸后，在中央网格继续手工修图。
4. 在右侧导出面板输出 PNG、CSV 或 JSON。

### 当前实现说明

- 当前 UI 默认只暴露单一工作台入口。
- 当前导入面板默认开放 `主体清理优先` 和 `最近色直出` 两种模式。
- 默认工程围绕 `50 x 50` 工作网格组织。
- 根目录 `docs/plans/` 保存了多份后续演进草案，可用来理解设计方向。

### 项目结构

```text
src/
  algorithms/    图像量化、特征提取、网格投影
  components/    编辑器、导入器、导出面板、色卡面板
  hooks/         网格状态与绘图交互
  utils/         图纸渲染、图像处理、像素工具
  data/          内置色卡数据
docs/plans/      功能规划与实现草案
```

### 验证

以下命令在仓库当前状态下可通过：

```bash
npm test
npm run lint
npm run build
```

## English

`Pingdou` is a browser-based perler bead pattern workstation built with React, TypeScript, and Vite. It combines image import, subject cropping, color quantization, 50x50 grid editing, and multi-format export in a single UI for fast pattern generation and manual cleanup.

### Current Features

- Import a reference image and remove connected white background areas
- Reposition and scale the subject before generating a 50x50 bead grid
- Match colors against the built-in `Mard` palette
- Edit the generated pattern with brush, eraser, picker, fill, line, rectangle, ellipse, and triangle tools
- Switch between color view, numbered view, and overlay view
- Use mirror drawing, undo/redo, and palette search
- Export color sheets, numbered sheets, overlay sheets, CSV summaries, and project JSON

### Stack

- React 19
- TypeScript 5
- Vite 7
- Tailwind CSS 4
- Vitest

### Getting Started

```bash
npm install
npm run dev
```

The local dev server is typically available at `http://localhost:5173`.

### Scripts

```bash
npm run dev
npm run build
npm run lint
npm test
```

### Workflow

1. Import a reference image from the main workspace.
2. Adjust crop and scale in the import modal, then choose the processing mode and target color count.
3. Generate the pattern and refine it in the central grid editor.
4. Export PNG, CSV, or JSON outputs from the export panel.

### Current Implementation Notes

- The public app currently exposes a single workspace entry.
- The import UI currently exposes `legacy-clean` and `legacy-nearest` processing modes by default.
- The app is currently organized around a `50 x 50` working grid.
- The `docs/plans/` directory contains design and implementation proposals for future iterations.

### Project Layout

```text
src/
  algorithms/    image quantization, feature extraction, grid projection
  components/    editor, importer, export panel, palette panel
  hooks/         grid state and drawing interactions
  utils/         pattern rendering, image processing, pixel tools
  data/          built-in palette data
docs/plans/      implementation and product planning notes
```

### Verification

The following commands pass on the current repository state:

```bash
npm test
npm run lint
npm run build
```
