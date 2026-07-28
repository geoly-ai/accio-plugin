# GEOly × Accio Work Plugin

把 GEOly（AI 搜索可见度分析，https://www.geoly.ai）打包成 [Accio Work](https://www.accio.com/work)
Plugin：`cli-login` Connector（浏览器 OAuth）+ 远程 MCP 桥 + `geoly-geo` Skill。

按 Accio 官方《Plugin 接入知识库》（钉钉，00-04 + 3.x/4.x 专题）规范实现；工程决策与规范出处见
[docs/INTEGRATION_NOTES.md](docs/INTEGRATION_NOTES.md)。

## 仓库结构

```
plugin/                     # Accio Work 插件包（评测时导入/打 zip 的就是这个目录）
├── plugin.json             # 插件清单（单一事实源）
├── prompt.md               # 插件级引导（被 Agent 引用时拼进 system prompt）
├── connectors/connectors.json  # cli-login Connector 完整定义（三方标准路径）
├── skills/geoly-geo/       # SKILL.md + display.txt + references/（自 geoly-app/geoly-mcp 移植）
└── resources/              # geoly.png (240×240) + i18n.json (en 默认 + zh / zh-TW)
packages/accio-mcp/         # @geoly/accio-mcp npm 包：login CLI + stdio↔远程 MCP 桥
docs/                       # 自测报告模板、接入决策记录
```

## 关键契约（改动前必读）

- `connectors.json → cli.credential.home = ".geoly/credentials"` 与 npm 包写盘路径是同一契约；
  凭据文件顶层 `account`/`email` 必须明文（Accio 授权卡片账号标签只认顶层明文）。
- `cli.auth.npmPackage` 与 `cli.mcpServer.npmPackage` 钉同版本（`@geoly/accio-mcp@x.y.z`），
  发版时三处一起 bump：npm 包版本、connectors.json 两处、plugin.json version。
- 品牌唯一写法为 **GEOly**（大小写敏感，所有用户可见位置一致——Accio 审核高频打回点）。
- `skills/geoly-geo/references/` 移植自 canonical 源 `geoly-app/geoly-mcp/references/`；
  SKILL.md 正文为 Accio 适配版（Prerequisites/连接段落不同），更新时 diff 移植、勿整文件覆盖。

## 本地调试（需 Accio Work 内测包）

1. 从接入知识库下载并安装 Accio Work 测试包（Win/Mac）。
2. 侧边栏「插件」→「导入本地插件」→ 选择本仓库 `plugin/` 目录（Windows 也支持 zip：
   `Compress-Archive plugin/* geoly-plugin.zip`）。
3. 插件详情页 → 应用授权 → Connect，走浏览器登录（本地联调可先
   `npm link` 或把 `npmPackage` 临时指到本地路径）。
4. 新建对话，`accio-mcp-cli toolkit geoly` 应能列出 GEOly 工具。

npm 包本体可独立冒烟：

```bash
node scripts/validate-i18n.mjs
node packages/accio-mcp/bin/cli.mjs --version
node packages/accio-mcp/bin/cli.mjs status
GEOLY_API_KEY=geom_xxx node packages/accio-mcp/bin/cli.mjs   # stdio 桥（echo JSON-RPC 进 stdin）
```

## 发布

1. **npm**（owner）：`cd packages/accio-mcp && npm publish --access public`（scope `@geoly` 需先在
   npm 注册）。
2. **插件提审**：按 `docs/SELF_TEST_REPORT.md` 完成三层自测 → 报告随 `plugin/` zip 包提交给
   Accio 对接群。
