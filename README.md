# GitHub Cloud Brief

这是一套为 GitHub Actions 设计的“云端自动生成并推送飞书”的模板。

目标：

- 不依赖本地电脑开机
- 每天自动生成 1 份中文综合晨报
- 用 OpenAI API + Web Search 获取最新市场信息
- 自动通过飞书 webhook 推送
- 保留较细颗粒度：市场主线、逐股催化、AI / crypto 主题、学习清单

## 工作方式

1. GitHub Actions 定时触发
2. 调用 OpenAI Responses API
3. 使用内置 `web_search` 工具检索最新市场信息
4. 生成完整 Markdown 报告
5. 提取 `## 拟发送到飞书的简版文本`
6. 发送到飞书机器人

## 仓库结构

- `.github/workflows/daily-brief.yml`：GitHub Actions 工作流
- `config/watchlists.json`：你的持仓与关注方向
- `prompts/daily_combined_brief.md`：提示词模板
- `scripts/run-daily-brief.mjs`：主脚本

## 你需要在 GitHub 仓库里设置的 Secrets

- `OPENAI_API_KEY`
- `FEISHU_WEBHOOK_URL`

可选 Variables / Secrets：

- `OPENAI_MODEL`
  - 默认建议先用 `gpt-5`
  - 如果后续成本过高，再换更便宜模型
- `OPENAI_BASE_URL`
  - 只有在你需要代理或兼容层时才设置

## 默认定时

当前默认是：

```text
每天 UTC 00:30
```

对应北京时间：

```text
每天 08:30
```

## 如何创建新仓库并上传

1. 你先在 GitHub 上新建一个空仓库
2. 把这个目录内容复制进去
3. 本地执行：

```bash
cd /path/to/your-new-repo
git init
git add .
git commit -m "Add daily market brief automation"
git branch -M main
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
```

## 如何先手动测试

你可以在 GitHub Actions 页面手动点 `Run workflow`。

工作流支持：

- 定时运行
- 手动运行

## 关于 token 成本

这套方案依然会消耗 token，因为“生成内容”是在云端调用 OpenAI API 完成的。

但相比你本地的多轮试错，它有两个优势：

1. 不依赖你本地电脑
2. 工作流和 prompt 固化后，更容易控制成本

## 输出策略

模板默认保留你偏好的信息密度：

- 今日一句话
- 持仓/关注名单逐只看
- AI / crypto 重仓方向细看
- 宏观与关键数据
- 值得继续深入学习
- 新的潜在观察名单
- 飞书简版文本

如果后面你想进一步控成本，优先做的是：

1. 缩小搜索范围
2. 减少不重要持仓的深挖
3. 保留详细 Markdown，但压缩飞书简版
