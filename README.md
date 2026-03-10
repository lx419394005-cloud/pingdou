# Loong 拼豆工房

<a href="https://github.com/lx419394005-cloud/pingdou">
  <img src="./public/icon-transparent.svg" alt="Loong 拼豆工房网址入口" width="72" />
</a>

`Loong 拼豆工房` 是一个浏览器端拼豆图纸工作台，覆盖从参考图导入到图纸导出的完整流程。

- 品牌：Loong 拼豆工房
- 主页文案：从参考图到可开做的拼豆方案，导入、抠图、配色、修图、导出一条龙
- 仓库地址：[https://github.com/lx419394005-cloud/pingdou](https://github.com/lx419394005-cloud/pingdou)

## 功能概览

### 1. 图片导入与生成
- 导入参考图，支持裁切和缩放
- 自动去除连通白底并生成网格图纸
- 生成模式支持：
- `主体清理优先`
- `最近色直出`
- 内置 `Mard` 色卡匹配

### 2. 网格编辑
- 常规工具：画笔、橡皮擦、油漆桶、取色
- 形状工具：直线、矩形填充、圆形填充、三角形填充
- 选区工具：
- 框选
- 移动选区
- 同色选取（点击后选中当前图层同色像素）
- 镜像绘制：关闭 / 左右 / 上下 / 四向
- 图层管理：新建、重命名、显隐、删除

### 3. 视图与交互
- 视图模式：像素 / 标号 / 临摹叠图
- 画布支持平移与缩放
- 双指滚动、右键拖拽、Space + 拖拽平移
- 浏览器页面级缩放已禁用（避免误缩放页面）
- 顶栏工程名支持双击重命名

### 4. 导出
- 导出完整图纸与用量信息
- 支持导出 PNG / CSV / JSON（由导出面板提供）

## 技术栈

- React 19
- TypeScript 5
- Vite 7
- Tailwind CSS 4
- Vitest

## 快速开始

```bash
npm install
npm run dev
```

默认开发地址：`http://localhost:5173`

## 脚本

```bash
npm run dev
npm run build
npm run lint
npm test
npm run preview
```

## 典型使用流程

1. 导入图片并在弹窗中调整主体范围。
2. 选择生成模式并生成拼豆网格。
3. 在编辑区使用绘制/选区/镜像工具修图。
4. 在右侧导出图纸与用量清单。

## 项目结构

```text
src/
  algorithms/    图像量化、特征提取、网格投影
  components/    GridEditor、ImageProcessor、ExportPanel、ColorPalette
  hooks/         网格状态与交互逻辑（含工具状态机）
  utils/         图像处理、像素与选区工具、网格缩放/配色工具
  data/          内置色卡数据
  config/        品牌配置
docs/plans/      功能规划与实现草案
```

## 说明

- 当前主要工作入口为单一工作台页面。
- 默认工作网格为 `50 x 50`。
- 详细变更与计划可参考 `docs/plans/`。
