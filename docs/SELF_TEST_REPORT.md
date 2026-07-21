# GEOly 自测报告

> 按 Accio《4.2 自测报告模板》结构预填；「⬜ 待测」项需装 Accio Work 内测包（Win/Mac 双端）后逐项完成，
> 截图列按模板要求补充（需体现 query + 回答）。

## 平台基本信息

| 项 | 值 |
|---|---|
| 评测内容 | GEOly |
| 评测时间 | ____ |
| 评测人 | ____ |
| Plugin 文件 | （插入 plugin/ 目录 zip 包） |
| 测试账号 | 账户名称：____ 账户密码：____（建议提供一个含监控数据的 GEOly 演示账号） |
| Tool 个数 | ____（连接后 `accio-mcp-cli toolkit geoly` 实数为准；随套餐/模式 30-63 个） |
| Skill 场景个数 | 5 |

## 一、Plugin 准入检查（全部通过才能继续）

| 序号 | 检查项 | 评测结果 | 截图 | 备注 |
|---|---|---|---|---|
| 1 | 敏感信息检查 | ✅ | | 包内无任何硬编码 key/token（仅生产端点 URL 常量） |
| 2 | Plugin 导入 | ⬜ 待测 | | 导入 `plugin/` 目录 |
| 3 | 组件加载 | ⬜ 待测 | | 应见 1 Connector (GEOly) + 1 Skill (geoly-geo) |
| 4 | 头像是否为官网最新 | ✅ | | 官方 logo 等比缩放 240×240；Plugin 与 Connector 同一文件 resources/geoly.png |
| 5 | Plugin 安装 | ⬜ 待测 | | |
| 6 | Plugin 卸载 | ⬜ 待测 | | 卸载后确认 `~/.geoly/credentials` 是否要求清理 |
| 7 | 多语言 | ⬜ 待测 | | en 默认 + zh 已配；切换界面语言验证 |

## 二、Connector 评测

| 序号 | 检查项 | 评测结果 | 截图 | 备注 |
|---|---|---|---|---|
| 1 | 授权指引 | ⬜ 待测 | | 详情页「应用授权」卡片 + connector description |
| 2 | 授权流程 | ⬜ 待测 | | 点击 Connect → 浏览器 GEOly 登录 → 卡片显示账号邮箱 |
| 3 | 授权失败提示 | ⬜ 待测 | | 超时/拒绝授权路径的 CLI 报错文案 |
| 4 | tool: list_organizations / list_brands | ⬜ 待测 | | 发现流起点 |
| 5 | tool: get_brand_overview | ⬜ 待测 | | KPI 基线 |
| 6 | tool: get_brand_citations_daily | ⬜ 待测 | | 日趋势 |
| 7 | tool: get_prompt_list / get_prompt_citations | ⬜ 待测 | | 逐 prompt + 引用来源 |
| 8 | tool: get_competitor_overview | ⬜ 待测 | | 竞品 |
| 9 | tool: search_public_entities / compare_public_brands | ⬜ 待测 | | 需 Grow+ 套餐账号 |
| … | （连接后按 toolkit 实际清单逐一补全） | | | |

## 三、Skill 评测（geoly-geo）

评分：触发 20% | 安全 20% | 合理 15% | 格式 15% | 效果 30%，每项 1-5 分；每场景 3 条 query 取平均。

| 场景 | 预期效果 | 评测结果 | 截图 | 触发 | 安全 | 合理 | 格式 | 效果 | 备注 |
|---|---|---|---|---|---|---|---|---|---|
| KPI 基线（"我们品牌这个月在 AI 里的引用率是多少"） | 调 get_brand_overview，引用 aigvr.citationRate 头条口径，与 GEOly 应用内数字一致 | ⬜ | | | | | | | |
| 日趋势（"最近 30 天 AI 可见度趋势"） | 调 get_brand_citations_daily，按日绘制、缺日按"未采集"处理、不做简单平均 | ⬜ | | | | | | | |
| 引用来源（"AI 回答里都引用了哪些网站"） | get_citation_overview / get_prompt_citations，区分 URL 口径与记录口径 | ⬜ | | | | | | | |
| 竞品对比（"我们和 XX 在 AI 里谁更强"） | get_competitor_overview 或 compare_public_brands（注明 record-weighted 非头条） | ⬜ | | | | | | | |
| 品类机会（"哪些话题我们值得投入"） | search_public_entities → get_category_whitespace，按 prioritize/gap 分桶给建议 | ⬜ | | | | | | | |

Skill 得分：____（加权平均）

## 四、汇总与结论

| 模块 | 结果 | 说明 |
|---|---|---|
| 准入检查 | ⬜ | |
| Connector | ⬜ | |
| Skill geoly-geo | 得分：____ | |
