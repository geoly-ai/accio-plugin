import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import {
  BASE_URL,
  CLIENT_NAME,
  CRED_DIR,
  LOGIN_CONFIG_FILE,
  LOGIN_ERROR_FILE,
  LOGIN_HELPER_FILE,
  MCP_URL,
  OAUTH_SCOPE,
  VERSION,
} from './config.mjs';
import { loadCredentials, saveCredentials } from './credentials.mjs';

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

/** base64url 编码（Node 18 Buffer 原生支持）。 */
function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

/** 简单 sleep。 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 拉取授权服务器元数据（RFC 8414）。
 * GEOly 生产返回 authorization/token/userinfo/registration 四个端点，均已实测存在。
 */
async function discoverAuthServer() {
  const res = await fetch(`${BASE_URL}/.well-known/oauth-authorization-server`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`OAuth discovery failed: HTTP ${res.status}`);
  const meta = await res.json();
  for (const k of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint']) {
    if (!meta[k]) throw new Error(`OAuth discovery missing ${k}`);
  }
  return meta;
}

/**
 * 动态客户端注册（RFC 7591）。
 * GEOly 支持 token_endpoint_auth_method=none 的公共客户端；redirect_uri 为本机 loopback 回调，
 * 每次登录端口随机，因此每次登录注册一个新 client（服务端幂等治理）。
 */
async function registerClient(meta, redirectUri) {
  const res = await fetch(meta.registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'GEOly Accio Plugin',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: OAUTH_SCOPE,
    }),
  });
  if (!res.ok) {
    throw new Error(`Dynamic client registration failed: HTTP ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/**
 * 跨平台打开浏览器。用绝对路径调系统 opener——被 Accio 这类 GUI App 以受限 PATH 的
 * 子进程拉起时，相对命令名可能解析不到。
 * ⚠️ Windows 不能裸走 `cmd /c start <url>`：URL 里的 & 是 cmd 元字符，会把 URL 在
 * 第一个 & 处截断（authorize 链接丢 client_id → invalid_client，实测复现）。
 * 首选 rundll32（不经 shell 解析，URL 原样传），cmd start 兜底时必须 ^ 转义 &。
 * GEOLY_NO_BROWSER=1 时跳过（测试/无头环境）。失败不抛错：授权 URL 已显著打印。
 */
function openBrowser(url) {
  if (process.env.GEOLY_NO_BROWSER) return false;
  const candidates =
    process.platform === 'win32'
      ? [
          ['rundll32', ['url.dll,FileProtocolHandler', url]],
          ['cmd', ['/c', 'start', '', url.replace(/&/g, '^&')]],
        ]
      : process.platform === 'darwin'
        ? [['/usr/bin/open', [url]], ['open', [url]]]
        : [['/usr/bin/xdg-open', [url]], ['xdg-open', [url]]];
  for (const [cmd, args] of candidates) {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
      child.on('error', () => {});
      child.unref();
      return true;
    } catch {
      /* 试下一个候选 */
    }
  }
  return false;
}

/** 解 JWT payload（不验签——仅取展示用的 email/name；数据面鉴权在服务端）。 */
function decodeJwtPayload(jwt) {
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * 授权码换 token（PKCE 公共客户端，带 RFC 8707 resource 参数指向 MCP 端点）。
 * refresh 时复用同一函数，grant 参数不同。
 */
async function tokenRequest(tokenEndpoint, params) {
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ ...params, resource: MCP_URL }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Token request failed: HTTP ${res.status} ${body.error || ''} ${body.error_description || ''}`.trim()
    );
  }
  return body;
}

/**
 * 幂等预检：本地凭据仍有效（或可用 refresh_token 换新）就直接成功返回，不再走浏览器。
 * 价值：宿主(Accio)对登录进程可能有超时会中途处决——守护进程最终会把凭据落盘，
 * 用户重试时这里秒过，不用重新授权。
 */
async function tryExistingCredentials() {
  const creds = loadCredentials();
  if (!creds?.access_token) return false;
  if (creds.expires_at && creds.expires_at - Date.now() > 60_000) {
    console.error(`[geoly] Already signed in as ${creds.account}.`);
    return true;
  }
  if (creds.refresh_token && creds.token_endpoint) {
    try {
      const next = await refreshCredentials(creds);
      console.error(`[geoly] Session refreshed for ${next.account}.`);
      return true;
    } catch {
      /* 刷新失败 → 走完整浏览器流 */
    }
  }
  return false;
}

/** 读失败上报文件（helper 写）；解析失败返回 null。 */
function readLoginError() {
  try {
    return JSON.parse(readFileSync(LOGIN_ERROR_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/** 轮询等待文件出现并通过 pick 提取字段；超时抛错。 */
async function waitForFile(file, timeoutMs, pick) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const v = pick(JSON.parse(readFileSync(file, 'utf8')));
      if (v !== undefined && v !== null) return v;
    } catch {
      /* 尚未写入 */
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${file}`);
}

/**
 * 登录主流程（编排进程）。核心设计：回调服务 + 授权码交换 + 凭据落盘全部放进
 * **双重派生的独立守护进程**（login → spawner(即退) → helper(常驻)）——宿主(Accio)
 * 对登录进程有超时处决时，杀掉本进程（甚至整棵进程树）也不影响授权完成；凭据最终
 * 落盘后宿主按「凭据文件出现」判定连接成功，或用户重试时幂等预检秒过。
 *
 * 流程：幂等预检 → 发现端点 → 起守护进程(文件握手拿回调端口) → DCR 注册 →
 * 下发一次性 OAuth 配置(0600) → 弹浏览器 → 轮询等待凭据出现/失败上报。
 */
export async function login() {
  if (await tryExistingCredentials()) return;

  const meta = await discoverAuthServer();

  mkdirSync(CRED_DIR, { recursive: true });
  for (const f of [LOGIN_HELPER_FILE, LOGIN_CONFIG_FILE, LOGIN_ERROR_FILE]) {
    try {
      rmSync(f);
    } catch {
      /* 无残留 */
    }
  }

  const startedAt = Date.now();

  // 双重派生断开进程树：中间层立刻退出，helper 不再是本进程的子孙
  spawn(process.execPath, [process.argv[1], '__login_spawn__'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();

  const port = await waitForFile(LOGIN_HELPER_FILE, 10_000, (j) => j.port);
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const client = await registerClient(meta, redirectUri);

  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(16));

  // 一次性配置下发给 helper（读取后即删；0600 与凭据文件同信任边界）
  writeFileSync(
    LOGIN_CONFIG_FILE,
    JSON.stringify({
      state,
      verifier,
      client_id: client.client_id,
      client_secret: client.client_secret || null,
      token_endpoint: meta.token_endpoint,
      userinfo_endpoint: meta.userinfo_endpoint || null,
      redirect_uri: redirectUri,
      started_at: startedAt,
    }),
    { mode: 0o600 }
  );

  const authUrl = new URL(meta.authorization_endpoint);
  authUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: redirectUri,
    scope: OAUTH_SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: MCP_URL,
  }).toString();

  // 显著打印授权 URL 到 stdout 和 stderr：即便自动弹窗被 GUI 宿主拦掉，
  // Accio 日志或用户终端里也能拿到链接手动打开。
  const banner = `\n========================================\nSign in to GEOly — open this URL in your browser:\n${authUrl}\n========================================\n`;
  process.stdout.write(banner);
  console.error(banner);
  const opened = openBrowser(authUrl.toString());
  console.error(
    opened
      ? '[geoly] Opened your default browser. Complete sign-in there.'
      : '[geoly] Browser not auto-opened — please open the URL above manually.'
  );

  // 等 helper 把凭据落盘（本进程被处决也没关系——helper 独立完成，重试幂等秒过）
  const deadline = startedAt + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const creds = loadCredentials();
    if (creds?.obtained_at && creds.obtained_at >= startedAt) {
      console.error(`[geoly] Signed in as ${creds.account}. You can close the browser tab.`);
      return;
    }
    const err = readLoginError();
    if (err?.at && err.at >= startedAt) {
      try {
        rmSync(LOGIN_ERROR_FILE);
      } catch {}
      throw new Error(err.message || 'Sign-in failed');
    }
    await sleep(500);
  }
  throw new Error('Sign-in timed out after 10 minutes');
}

/** 双重派生的中间层：起真正的 helper 后立刻退出，切断与 login 进程的树关系。 */
export function runLoginSpawner() {
  spawn(process.execPath, [process.argv[1], '__login_helper__'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

/** helper 侧失败上报 + 退出。 */
function helperFail(message, exitCode = 1) {
  try {
    mkdirSync(CRED_DIR, { recursive: true });
    writeFileSync(LOGIN_ERROR_FILE, JSON.stringify({ message, at: Date.now() }));
  } catch {}
  try {
    rmSync(LOGIN_HELPER_FILE);
  } catch {}
  process.exit(exitCode);
}

/**
 * 登录守护进程（独立存活，不受 login 进程死活影响）：
 * 绑定 loopback 回调端口 → 写握手文件上报端口 → 轮询读取一次性 OAuth 配置(读后即删) →
 * 接浏览器回调(校验 state) → 授权码换 token(PKCE) → 取身份(id_token/userinfo) →
 * 写 ~/.geoly/credentials(顶层明文 account/email = Accio 硬契约) → 回浏览器成功页 → 退出。
 * 总超时 10 分钟；任何失败写 LOGIN_ERROR_FILE 供编排进程/下次登录读取。
 */
export async function runLoginHelper() {
  let cfg = null;
  let cfgResolve;
  const cfgReady = new Promise((r) => {
    cfgResolve = r;
  });
  const cfgTimer = setInterval(() => {
    try {
      cfg = JSON.parse(readFileSync(LOGIN_CONFIG_FILE, 'utf8'));
      try {
        rmSync(LOGIN_CONFIG_FILE);
      } catch {}
      clearInterval(cfgTimer);
      cfgResolve();
    } catch {
      /* 配置尚未写入 */
    }
  }, 100);

  // 配置迟迟不来（login 编排进程半路死了且没下发配置）→ 自杀清场
  setTimeout(() => {
    if (!cfg) helperFail('Login orchestrator never delivered OAuth config');
  }, 60_000);

  // 总超时：用户一直没完成浏览器授权
  setTimeout(() => helperFail('Sign-in timed out after 10 minutes'), LOGIN_TIMEOUT_MS);

  const finishPage = (res, ok, detail) => {
    res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><meta charset="utf-8"><title>GEOly</title><body style="font-family:system-ui;display:grid;place-items:center;height:90vh"><div style="text-align:center"><h2>${ok ? 'Signed in to GEOly' : 'Sign-in failed'}</h2><p>${ok ? 'You can close this tab and return to Accio Work.' : detail}</p></div>`
    );
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/callback') {
      res.writeHead(404).end();
      return;
    }
    await cfgReady; // 正常时序里配置远早于回调到达；此处仅兜底
    const err = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const fail = err
      ? `Authorization failed: ${err} ${url.searchParams.get('error_description') || ''}`
      : state !== cfg.state
        ? 'Authorization failed: state mismatch'
        : !code
          ? 'Authorization failed: missing code'
          : null;
    if (fail) {
      finishPage(res, false, fail);
      setTimeout(() => helperFail(fail), 300);
      return;
    }

    try {
      const params = {
        grant_type: 'authorization_code',
        code,
        redirect_uri: cfg.redirect_uri,
        client_id: cfg.client_id,
        code_verifier: cfg.verifier,
      };
      if (cfg.client_secret) params.client_secret = cfg.client_secret;
      const tokens = await tokenRequest(cfg.token_endpoint, params);

      // 身份信息：id_token 里拿 email/name；拿不到再打 userinfo；最后回退固定标签
      let identity = tokens.id_token ? decodeJwtPayload(tokens.id_token) : null;
      if (!identity?.email && cfg.userinfo_endpoint) {
        identity = await fetch(cfg.userinfo_endpoint, {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
      }
      const email = identity?.email || null;
      const account = email || identity?.name || 'GEOly account';

      saveCredentials({
        account,
        email,
        name: identity?.name || null,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
        token_type: tokens.token_type || 'Bearer',
        expires_at: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,
        obtained_at: Date.now(),
        client_id: cfg.client_id,
        client_secret: cfg.client_secret || null,
        token_endpoint: cfg.token_endpoint,
        base_url: BASE_URL,
        client: `${CLIENT_NAME}/${VERSION}`,
      });

      finishPage(res, true);
      try {
        rmSync(LOGIN_HELPER_FILE);
      } catch {}
      setTimeout(() => process.exit(0), 300);
    } catch (e) {
      finishPage(res, false, e.message);
      setTimeout(() => helperFail(e.message), 300);
    }
  });

  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  mkdirSync(CRED_DIR, { recursive: true });
  writeFileSync(
    LOGIN_HELPER_FILE,
    JSON.stringify({ port: server.address().port, pid: process.pid, at: Date.now() })
  );
}

/**
 * 用 refresh_token 刷新 access_token；服务端未轮换 refresh_token 时保留旧值。
 * 返回更新后的凭据对象（已落盘）。
 */
export async function refreshCredentials(creds) {
  if (!creds?.refresh_token) throw new Error('no refresh_token');
  const params = {
    grant_type: 'refresh_token',
    refresh_token: creds.refresh_token,
    client_id: creds.client_id,
  };
  if (creds.client_secret) params.client_secret = creds.client_secret;
  const tokens = await tokenRequest(creds.token_endpoint, params);

  const next = {
    ...creds,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || creds.refresh_token,
    expires_at: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : creds.expires_at,
    obtained_at: Date.now(),
  };
  saveCredentials(next);
  return next;
}
