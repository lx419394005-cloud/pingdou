# 拼豆图纸编辑器升级 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 完善拼豆网页的导入、主体提取、阅览、编辑、叠图与导出能力，并统一为中文界面。

**Architecture:** 先把白底剔除、主体边界识别、颜色编号映射沉到纯函数工具层，用测试锁定行为；再扩展图片导入组件输出叠图预览和裁切结果；最后重构编辑器与导出面板，支持编号阅览、手动增删像素、叠图辅助和多格式图纸导出。

**Tech Stack:** React 19, TypeScript, Vitest, Vite, Tailwind CSS

---

### Task 1: 为图像预处理与图纸编号补测试

**Files:**
- Create: `src/utils/imageProcessing.test.ts`
- Create: `src/utils/pattern.test.ts`

**Step 1: Write the failing test**

添加测试覆盖：
- 去除边缘连通白底，但保留主体色块
- 基于非透明区域计算主体边界
- 为图纸中的颜色生成稳定编号和统计结果

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL，因为这些工具函数尚未存在。

### Task 2: 实现图像预处理工具

**Files:**
- Create: `src/utils/imageProcessing.ts`

**Step 1: Write minimal implementation**

实现：
- 白底连通区域剔除
- 主体边界识别
- 对外暴露便于 `ImageProcessor` 复用的裁切辅助函数

**Step 2: Run tests**

Run: `npm test`

Expected: 新增测试通过。

### Task 3: 扩展编辑器状态与视图模型

**Files:**
- Modify: `src/hooks/useGridState.ts`
- Create: `src/utils/pattern.ts`

**Step 1: Write minimal implementation**

实现：
- 绘制/擦除编辑模式
- 稳定历史记录提交
- 颜色编号映射供编辑器和导出面板共享

**Step 2: Run tests**

Run: `npm test`

Expected: 工具层测试继续通过。

### Task 4: 重构导入、编辑和导出 UI

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/ImageProcessor/index.tsx`
- Modify: `src/components/GridEditor/index.tsx`
- Modify: `src/components/ExportPanel/index.tsx`
- Modify: `src/components/ColorPalette/index.tsx`
- Modify: `src/components/ResolutionConfig/index.tsx`
- Modify: `src/index.css`

**Step 1: Write minimal implementation**

实现：
- 中文界面
- 左侧豆子列表折叠
- 导入图片裁切、自动去白底、自由缩放
- 带标号阅览模式
- 手动添加/删除像素点
- 叠图模式
- 完整图纸导出

**Step 2: Run verification**

Run:
- `npm test`
- `npm run build`
- `npm run lint`

Expected:
- 测试通过
- 构建通过
- lint 没有新增错误
