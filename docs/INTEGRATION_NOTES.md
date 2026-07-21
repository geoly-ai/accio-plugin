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
| MCP 接入 | npm 包内置 stdio↔远程 Streamable HTTP 桥 | GEOly 远程 MCP 无状态、仅 POST（GET/DELETE→405）；桥为纯请求-响应转发，处理 JSON 与 SSE 两种响应格式 |
| 静态 token | `GEOLY_API_KEY`（geom_ 只读）优先于 OAuth | headless/CI 兜底，零服务端改造 |
| 品牌写法 | **GEOly**（owner 拍板 2026-07-21） | 02 文档跨位置一致性强制 |
| i18n | defaultLocale=en + zh 翻译 | 3.1 手册 entries v1.0 格式；13 语言后续按需补 |

## 版本钉死约定

`connectors.json` 里 `auth.npmPackage` 与 `mcpServer.npmPackage` 均钉 `@geoly/accio-mcp@0.1.0`
（03 文档建议同版本防 npx latest 漂移）。发版四处同步 bump：npm 包、connectors.json ×2、
plugin.json。

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
| 品牌色 `color: #111111` | 按 logo 黑色暂定，设计侧可改 |
| icon | 由官方 logo.png 等比缩放至 240×240 PNG（02 规范允许）；有官方 SVG 后替换更佳 |
| device-code 登录（webAuth） | **P2 未做**。需 GEOly 服务端支持 RFC 8628 device grant（Better Auth mcp 插件当前无）；不做则网页版/远端沙箱用户无法授权，桌面端不受影响 |
| 多 org 用户 | OAuth 同意页选 org；`geom_` 用户级 token 在多 org 下会关 public 工具组（geoly-app 已知门控），文档已在 skill 中说明 |
| npm scope `@geoly` | owner 注册；发布需 `--access public`（Accio 要求公网 npx 可拉取） |

## 评测准备（对照 4.1）

- 第一层准入：无硬编码密钥（本包只有端点 URL 常量）✅ / JSON 全部通过本地 `JSON.parse` ✅ /
  头像 240×240 官方 logo ✅ / i18n 已配 ✅ —— 导入/安装/卸载三项待测试包实测。
- 第二层授权：授权指引=connector `description` + skill Prerequisites；失败提示=login CLI 的
  明确报错文案；tool 逐一测试待联调（工具数取决于账号套餐/模式）。
- 第三层 Skill：建议场景（自测报告模板已预填）——KPI 基线查询、日趋势、引用来源、竞品对比、
  品类空白，每场景 3 条同义 query。
