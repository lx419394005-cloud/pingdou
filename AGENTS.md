# Agent Rules

## 项目部署说明

- 本项目部署在 CloudBase（云开发静态托管），通过 GitHub 仓库自动拉取并执行构建。
- 云端构建命令使用：`npm run build`。
- 为兼容 CloudBase 静态路径，Vite 使用相对资源路径（`vite.config.ts` 中 `base: './'`）。
- 涉及静态资源路径相关改动时，需优先检查云端是否会出现 `/assets/*` 404。

## Commit 约定

- 当用户说“执行 /commit”或表达“提交并推送”时，默认执行：
- `git add .`
- `git commit -m "<中文标题>"`
- `git push origin main`
- 提交信息必须使用中文。
- 若用户提供提交标题，优先使用用户提供的中文标题。
- 若没有可提交改动，直接告知“当前没有可提交内容”，不创建空提交。
