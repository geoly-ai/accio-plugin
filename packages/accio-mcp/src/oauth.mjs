import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { BASE_URL, CLIENT_NAME, MCP_URL, OAUTH_SCOPE, VERSION } from './config.mjs';
import { saveCredentials } from './credentials.mjs';

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

/** base64url 编码（Node 18 Buffer 原生支持）。 */
function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
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

/** 跨平台打开浏览器；失败不抛错（终端里已打印 URL 兜底）。 */
function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* URL 已打印，忽略 */
  }
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
 * 登录主流程：起 loopback 回调服务 → 发现端点 → DCR 注册 → 开浏览器授权(PKCE S256)
 * → 授权码换 token → 取用户身份(id_token 优先, userinfo 兜底) → 写 ~/.geoly/credentials。
 * 凭据文件顶层 account/email 明文是 Accio 授权卡片账号标签的硬契约。
 */
export async function login() {
  const meta = await discoverAuthServer();

  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(16));

  // loopback 回调服务：端口随机，收到 /callback 即完成
  const { server, port, waitForCode } = await startCallbackServer(state);
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  try {
    const client = await registerClient(meta, redirectUri);

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

    console.error('[geoly] Opening your browser to sign in to GEOly…');
    console.error(`[geoly] If it does not open, visit:\n${authUrl}`);
    openBrowser(authUrl.toString());

    const code = await waitForCode;

    const tokens = await tokenRequest(meta.token_endpoint, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: client.client_id,
      code_verifier: verifier,
    });

    // 身份信息：id_token 里拿 email/name；拿不到再打 userinfo；最后回退固定标签
    let identity = tokens.id_token ? decodeJwtPayload(tokens.id_token) : null;
    if (!identity?.email && meta.userinfo_endpoint) {
      identity = await fetch(meta.userinfo_endpoint, {
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
      client_id: client.client_id,
      client_secret: client.client_secret || null,
      token_endpoint: meta.token_endpoint,
      base_url: BASE_URL,
      client: `${CLIENT_NAME}/${VERSION}`,
    });

    console.error(`[geoly] Signed in as ${account}. You can close the browser tab.`);
  } finally {
    server.close();
  }
}

/**
 * 起本机回调 HTTP 服务，返回 {server, port, waitForCode}。
 * 校验 state，向浏览器回一页成功/失败提示；超时 10 分钟自动失败退出。
 */
function startCallbackServer(expectedState) {
  let resolveCode;
  let rejectCode;
  const waitForCode = new Promise((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const timer = setTimeout(
    () => rejectCode(new Error('Sign-in timed out after 10 minutes')),
    LOGIN_TIMEOUT_MS
  );

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/callback') {
      res.writeHead(404).end();
      return;
    }
    const err = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const fail = err
      ? `Authorization failed: ${err} ${url.searchParams.get('error_description') || ''}`
      : state !== expectedState
        ? 'Authorization failed: state mismatch'
        : !code
          ? 'Authorization failed: missing code'
          : null;

    res.writeHead(fail ? 400 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><meta charset="utf-8"><title>GEOly</title><body style="font-family:system-ui;display:grid;place-items:center;height:90vh"><div style="text-align:center"><h2>${fail ? 'Sign-in failed' : 'Signed in to GEOly'}</h2><p>${fail ? fail : 'You can close this tab and return to Accio Work.'}</p></div>`
    );

    clearTimeout(timer);
    if (fail) rejectCode(new Error(fail));
    else resolveCode(code);
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, waitForCode });
    });
  });
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
