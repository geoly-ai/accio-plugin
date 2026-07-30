import { MCP_URL, VERSION } from './config.mjs';
import { clearCredentials, loadCredentials } from './credentials.mjs';

const HELP = `GEOly Accio connector CLI v${VERSION}

Usage:
  geoly-accio-mcp tools                          List available GEOly tools (--json = full parameter schemas)
  geoly-accio-mcp call <tool> --json '<args>'    Call one GEOly tool; args = ONE JSON object (--json '{}' if none)
                                                 Options: --timeout <seconds> (default 120)
  geoly-accio-mcp login                          Sign in to GEOly in your browser (writes ~/.geoly/credentials)
  geoly-accio-mcp logout                         Remove the stored GEOly session
  geoly-accio-mcp status                         Show sign-in status
  geoly-accio-mcp                                (no args) Run the stdio MCP bridge to ${MCP_URL}

Examples:
  geoly-accio-mcp call get_brand_overview --json '{"time_range":"30d"}'
  geoly-accio-mcp call search_public_entities --json '{"query":"wireless earbuds"}'

Exit codes: 0 ok · 1 tool/transport error · 2 usage error

Environment:
  GEOLY_API_KEY   Use a read-only geom_ static token instead of the stored login
  GEOLY_BASE_URL  Override the GEOly base URL (testing only)
  GEOLY_DEBUG     Verbose bridge logging on stderr
`;

/** 解析 tools/call 子命令的选项：--json（tools=布尔开关 / call=取下一个值）与 --timeout 秒数。 */
function parseInvokeFlags(rest, jsonTakesValue) {
  const opts = { positional: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--json') {
      if (jsonTakesValue) opts.argsJson = rest[++i];
      else opts.json = true;
    } else if (a === '--timeout') {
      const sec = Number(rest[++i]);
      if (!Number.isFinite(sec) || sec <= 0) throw Object.assign(new Error('--timeout expects seconds, e.g. --timeout 180'), { exitCode: 2 });
      opts.timeoutMs = sec * 1000;
    } else {
      opts.positional.push(a);
    }
  }
  return opts;
}

/**
 * CLI 入口分发：login / logout / status / --version / --help，
 * 无参数默认启动 stdio MCP 桥（Accio Work 以 `npx -y @geoly/accio-mcp` 起 MCP server 的约定）。
 */
export async function main(argv) {
  const cmd = argv[0];

  if (cmd === '--version' || cmd === '-v') {
    console.log(VERSION);
    return;
  }
  if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
    console.log(HELP);
    return;
  }
  // tools / call：agent 直调路径（Accio 官方包内 CLI 模式，同 dws——不经 MCP toolkit 注册）
  if (cmd === 'tools' || cmd === 'call') {
    const { runTools, runCall } = await import('./invoke.mjs');
    try {
      const opts = parseInvokeFlags(argv.slice(1), cmd === 'call');
      if (cmd === 'tools') {
        await runTools(opts);
      } else {
        const name = opts.positional[0];
        if (!name) {
          console.error("[geoly] Usage: geoly-accio-mcp call <tool> --json '<args JSON>'");
          process.exit(2);
        }
        await runCall(name, opts.argsJson, opts);
      }
    } catch (e) {
      console.error(`[geoly] ${e.message}`);
      process.exit(e.exitCode ?? 1);
    }
    return;
  }
  if (cmd === 'login') {
    const { login } = await import('./oauth.mjs');
    await login();
    return;
  }
  // 内部子命令（登录守护进程机制，勿在 help 暴露）：
  // __login_spawn__ = 双重派生中间层；__login_helper__ = 常驻回调/换 token/写凭据的守护进程
  if (cmd === '__login_spawn__') {
    const { runLoginSpawner } = await import('./oauth.mjs');
    runLoginSpawner();
    return;
  }
  if (cmd === '__login_helper__') {
    const { runLoginHelper } = await import('./oauth.mjs');
    await runLoginHelper();
    return;
  }
  if (cmd === 'logout') {
    console.error(clearCredentials() ? '[geoly] Signed out.' : '[geoly] No stored session.');
    return;
  }
  if (cmd === 'status') {
    const creds = loadCredentials();
    console.log(
      creds
        ? `Signed in as ${creds.account}${creds.expires_at ? ` (token ${creds.expires_at > Date.now() ? 'valid' : 'expired'})` : ''}`
        : 'Not signed in.'
    );
    return;
  }
  if (cmd) {
    console.error(`[geoly] Unknown command: ${cmd}\n`);
    console.error(HELP);
    process.exit(2);
  }

  const { runBridge } = await import('./bridge.mjs');
  await runBridge();
}
