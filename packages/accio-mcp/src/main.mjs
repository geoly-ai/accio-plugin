import { MCP_URL, VERSION } from './config.mjs';
import { clearCredentials, loadCredentials } from './credentials.mjs';

const HELP = `GEOly Accio connector CLI v${VERSION}

Usage:
  geoly-accio-mcp login     Sign in to GEOly in your browser (writes ~/.geoly/credentials)
  geoly-accio-mcp logout    Remove the stored GEOly session
  geoly-accio-mcp status    Show sign-in status
  geoly-accio-mcp           (no args) Run the stdio MCP bridge to ${MCP_URL}

Environment:
  GEOLY_API_KEY   Use a read-only geom_ static token instead of the stored login
  GEOLY_BASE_URL  Override the GEOly base URL (testing only)
  GEOLY_DEBUG     Verbose bridge logging on stderr
`;

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
