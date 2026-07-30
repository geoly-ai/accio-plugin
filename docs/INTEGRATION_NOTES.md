# 接入决策记录（对照 Accio《Plugin 接入知识库》）

依据：Accio 官方钉钉知识库《00 Plugin 接入流程总览》《01 What is Plugin》《02 Plugin 上架规范》
《03 Plugin 技术接入规范》《04 Plugin 评测流程》《4.1 评测标准》《4.2 自测报告模板》
《3.1 多语言接入手册》《3.5 Skill Tool Triggers》（2026-07 版）。

## 形态决策

| 决策 | 选择 | 依据 |
|---|---|---|
| 组件组合 | Skill + Connector（无 SubAgent/CLI Tool） | 01 文档「最常见、最适合外部团队自助接入」形态（GitHub 同款） |
| 授权方式 | `cli-login` 声明式自带 Connector（§6.3.2） | 00 文档：三方不开发标准 Connector，一律 cli-login |
| 登录流 | 浏览器 loopback OAuth（PKCE S256 + DCR，公共客户端） | GEOly 生产 OAuth 已支持（well-known 实测：authorize/token/register/userinfo，`token_endpoint_auth_method: none`，`offline_access`） |
| MCP 接入 | **0.2.13 起：包内 CLI 直调**（`geoly-accio-mcp tools` / `call <tool> --json`，一次性 POST 远程 Streamable HTTP）——对齐官方钉钉 dws 模式：cli-login 连接器只管授权，agent 直接命令行调 CLI，不经 MCP toolkit 注册。stdio 桥保留为无参默认行为。教训：`cli.mcpServer` 是 MCP toolkit 注册的唯一来源且必然走 npm 下载，删它=toolkit 消失（0.2.12 真机实证），"包内模式"必须 CLI 直调 | GEOly 远程 MCP 无状态、仅 POST（GET/DELETE→405）；tools/call 免 initialize 直调已真机验证；JSON 与 SSE 两种响应格式均处理 |
| 静态 token | `GEOLY_API_KEY`（geom_ 只读）优先于 OAuth | headless/CI 兜底，零服务端改造 |
| 品牌写法 | **GEOly**（owner 拍板 2026-07-21） | 02 文档跨位置一致性强制 |
| i18n | defaultLocale=en + zh / zh-TW 翻译 | 2.1 手册 entries v1.0 格式；CLI 使用 `cli.{id}.name`；其余 10 种语言后续按需补 |

## 版本钉死约定

**0.2.12 起**：`cli.mcpServer` 已删（Accio 评测方 2026-07 反馈：声明它会走 npm 下载，
其内网镜像拉不到 `@geoly/accio-mcp`）——MCP 全部走插件包内 CLI（`clis/geoly.mjs`）。
`connectors.json` 仅剩 `auth.npmPackage` 钉 `@geoly/accio-mcp@0.1.0` 作登录兜底
（包内 CLI 在场时不触发，防 npx latest 漂移，常态不动）。发版同步 bump 见下节清单。

## 更新 / 发版流程（两阶段）

**阶段 A · 评测期（本地导入，现状）**：更新 = 重新导入新 zip。Accio 按 `plugin.json` 的
`name` 识别同一插件、按 `version` 识别新版本（版本号必须递增）。实操路径（0.2.5→0.2.12
已多次验证）：插件页删除旧版 → 导入新 zip → 重走"应用到 Agent"；**若改动涉及
connectors.json / clis.json，需重连一次授权**；只动 skill/i18n/文案则授权保留。

**阶段 B · 上架后（Plugin Center 分发）**：分发权在 Accio 平台侧，开发者不能自行推送。
发版 = 交付新 zip（版本号递增）+ 变更说明给 Accio 对接群/评测通道 → 平台按改动面做
增量评测（动 connector/CLI 重测授权层；仅 skill/文案轻量复核）→ 审核通过后由 Accio
在插件中心发布 → 终端用户从插件中心获取新版本（推送/提示由平台机制决定）。

**我方发版清单**：①bump `plugin.json` version（若动 skill 同步 bump 其 frontmatter
version）→ ②若改了 `packages/accio-mcp` 跑 `scripts/bundle-cli.mjs` 重新生成
`plugin/clis/geoly.mjs` → ③`Compress-Archive plugin/* geoly-plugin-<ver>.zip` →
④交付 zip + 变更说明。**0.2.12 起 MCP 全走包内 CLI，发版不再依赖 npm 发包**
（`auth.npmPackage` 仅登录兜底，钉 0.1.0 不动）。仓库已公开
（github.com/geoly-ai/accio-plugin），可用 GitHub Releases 挂 zip 提供稳定下载地址。

**决策：不做运行时自更新（CLI 拉 GitHub 更新自己）**——①`node-cli` source 无更新字段，
唯一外拉通道 npm-package 已被评测方否掉；②loader 式运行时拉代码=远程代码执行，违背
评测方"全部包内"的明确要求，且国内到 GitHub raw 可达性差、无签名校验则仓库被盗=全员 RCE；
③架构上不需要：桥是纯转发，工具面/逻辑全在服务端，服务端发版即生效；需动包的只有
skill/connector/桥修复（低频），走"交新 zip → Accio 发布"。GitHub 仅作人拉的分发渠道。

## 凭据契约（03 §6.3.2）

- 路径：`~/.geoly/credentials`（home 相对路径，connector 声明与 npm 包共用）。
- 顶层明文 `account` / `email` = Accio 授权卡片账号标签来源，**不解嵌套、不解密**；
  升级不得挪位/改名/加密。
- 框架检测「凭据文件出现」判定连接成功；login 成功即写盘并 exit 0。

## 待确认 / 已知风险

| 项 | 状态 |
|---|---|
| `category` 标准分类 ID | **暂填 `marketing` 占位** —— 《3.3 Plugin 分类清单》未公开分享，需向 Accio 对接群要清单后改 |
| connectors.json 具体 JSON 形态 | 官方文档代码块示例（dingtalk/feishu）在网页版不可见，本文件按字段表推导；**首次导入测试包即可验证**（评测第一层第 2 项） |
| Connector `visibility` | 未声明（默认）；要不要上全局 Connectors 页由 Accio 对接定 |
| 插件是否支持 URL/git 仓库导入源（自动拉更新） | **待问对接群**。当前仅本地目录/zip 导入 + 插件中心分发，无 git 直连；若平台支持/在做，本仓库（已 public）零改造可作更新源。评测期折中：测试机 clone 仓库、导入 `plugin/` 目录，更新=git pull+重导 |
| 品牌色 `color: #111111` | 按 logo 黑色暂定，设计侧可改 |
| icon | 由官方 logo.png 等比缩放至 240×240 PNG（02 规范允许）；有官方 SVG 后替换更佳 |
| device-code 登录（webAuth） | **P2 未做**。需 GEOly 服务端支持 RFC 8628 device grant（Better Auth mcp 插件当前无）；不做则网页版/远端沙箱用户无法授权，桌面端不受影响 |
| 多 org 用户 | OAuth 同意页选 org；`geom_` 用户级 token 在多 org 下会关 public 工具组（geoly-app 已知门控），文档已在 skill 中说明 |
| npm scope `@geoly` | owner 注册；发布需 `--access public`（Accio 要求公网 npx 可拉取） |

## 评测准备（对照 4.1）

- 第一层准入：无硬编码密钥（本包只有端点 URL 常量）✅ / JSON 全部通过本地 `JSON.parse` ✅ /
  头像 240×240 官方 logo ✅ / i18n 覆盖 en / zh / zh-TW 的 Plugin、Skill、CLI、Connector
  展示字段 ✅ —— 导入/安装/卸载三项待测试包实测。
- 第二层授权：授权指引=connector `description` + skill Prerequisites；失败提示=login CLI 的
  明确报错文案；tool 逐一测试待联调（工具数取决于账号套餐/模式）。
- 第三层 Skill：建议场景（自测报告模板已预填）——KPI 基线查询、日趋势、引用来源、竞品对比、
  品类空白，每场景 3 条同义 query。
