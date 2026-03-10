# Agent Rules

## Commit 约定

- 当用户说“执行 /commit”或表达“提交并推送”时，默认执行：
- `git add .`
- `git commit -m "<中文标题>"`
- `git push origin main`
- 提交信息必须使用中文。
- 若用户提供提交标题，优先使用用户提供的中文标题。
- 若没有可提交改动，直接告知“当前没有可提交内容”，不创建空提交。
