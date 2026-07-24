/**
 * 登录守护进程 E2E（无外网依赖）：
 * 起本地 mock OAuth 服务器（discovery/register/token/userinfo），用临时 HOME 跑真实
 * `login` 子进程，模拟浏览器回调，断言凭据落盘。覆盖两条路径：
 *   ① 正常流：login 存活 → 回调 → 凭据落盘 → login 以 0 退出
 *   ② 处决流：**SIGKILL 杀掉 login 编排进程后**再回调 → 守护进程独立完成 → 凭据仍落盘
 *      （这是对"Accio 超时杀登录进程导致授权半途而废"的直接回归测试）
 *   ③ 幂等流：凭据已存在时再跑 login → 不开浏览器直接成功退出
 * 运行：node packages/accio-mcp/test/login-e2e.mjs
 */
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

// GEOLY_E2E_CLI 可覆盖被测入口（用于测 bundle 单文件版 plugin/clis/geoly.mjs）
const CLI =
  process.env.GEOLY_E2E_CLI ||
  join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** mock OAuth 服务器：四个端点全部指向自身。 */
function startMockAuth() {
  const server = createServer((req, res) => {
    const json = (obj) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    const base = `http://127.0.0.1:${server.address().port}`;
    if (req.url.startsWith('/.well-known/oauth-authorization-server')) {
      json({
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        userinfo_endpoint: `${base}/userinfo`,
      });
    } else if (req.url.startsWith('/register')) {
      json({ client_id: 'mock_client_id', client_secret: null });
    } else if (req.url.startsWith('/token')) {
      json({
        access_token: 'at_e2e_123',
        refresh_token: 'rt_e2e_456',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    } else if (req.url.startsWith('/userinfo')) {
      json({ email: 'e2e@geoly.ai', name: 'E2E Tester' });
    } else {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/** 跑一轮 login：返回 {child, banner url 解析出的 redirect_uri/state, home}。 */
async function startLogin(mockBase, home) {
  const child = spawn(process.execPath, [CLI, 'login'], {
    env: {
      ...process.env,
      USERPROFILE: home, // Windows homedir()
      HOME: home, // POSIX homedir()
      GEOLY_BASE_URL: mockBase,
      GEOLY_NO_BROWSER: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (out += c));

  // 等 banner 里的授权 URL（含 redirect_uri + state）
  const deadline = Date.now() + 15_000;
  let authUrl = null;
  while (Date.now() < deadline && !authUrl) {
    const m = out.match(/(https?:\/\/[^\s]+\/authorize\?[^\s]+)/);
    if (m) authUrl = new URL(m[1]);
    else await sleep(100);
  }
  assert.ok(authUrl, `未在输出中找到授权 URL：\n${out}`);
  return {
    child,
    redirectUri: authUrl.searchParams.get('redirect_uri'),
    state: authUrl.searchParams.get('state'),
    getOutput: () => out,
  };
}

/** 轮询等待凭据文件出现并断言内容。 */
async function expectCredentials(home) {
  const file = join(home, '.geoly', 'credentials');
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const creds = JSON.parse(readFileSync(file, 'utf8'));
      assert.equal(creds.access_token, 'at_e2e_123');
      assert.equal(creds.email, 'e2e@geoly.ai');
      assert.equal(creds.account, 'e2e@geoly.ai');
      assert.ok(creds.refresh_token);
      return creds;
    } catch {
      await sleep(200);
    }
  }
  assert.fail('10s 内凭据文件未出现');
}

const mock = await startMockAuth();
const mockBase = `http://127.0.0.1:${mock.address().port}`;

// ── ① 正常流 ──
{
  const home = mkdtempSync(join(tmpdir(), 'geoly-e2e-'));
  const { child, redirectUri, state } = await startLogin(mockBase, home);
  await fetch(`${redirectUri}?code=fake_code&state=${encodeURIComponent(state)}`);
  await expectCredentials(home);
  const code = await new Promise((r) => child.on('close', r));
  assert.equal(code, 0, 'login 编排进程应以 0 退出');
  rmSync(home, { recursive: true, force: true });
  console.log('① 正常流 PASS（回调→凭据落盘→exit 0）');
}

// ── ② 处决流：杀掉编排进程后守护进程独立完成 ──
{
  const home = mkdtempSync(join(tmpdir(), 'geoly-e2e-'));
  const { child, redirectUri, state } = await startLogin(mockBase, home);
  child.kill('SIGKILL'); // 模拟 Accio 超时处决登录进程
  await sleep(300);
  await fetch(`${redirectUri}?code=fake_code&state=${encodeURIComponent(state)}`);
  await expectCredentials(home);
  console.log('② 处决流 PASS（编排进程被杀→守护进程仍完成→凭据落盘）');

  // ── ③ 幂等流：凭据已在，再跑 login 秒过 ──
  const again = spawn(process.execPath, [CLI, 'login'], {
    env: {
      ...process.env,
      USERPROFILE: home,
      HOME: home,
      GEOLY_BASE_URL: mockBase,
      GEOLY_NO_BROWSER: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out2 = '';
  again.stderr.on('data', (c) => (out2 += c));
  const code2 = await new Promise((r) => again.on('close', r));
  assert.equal(code2, 0);
  assert.match(out2, /Already signed in/);
  rmSync(home, { recursive: true, force: true });
  console.log('③ 幂等流 PASS（已有凭据→秒过 exit 0）');
}

mock.close();
console.log('login-e2e: all assertions passed');
process.exit(0);
