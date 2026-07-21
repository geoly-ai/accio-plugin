import { CLIENT_NAME, MCP_URL, VERSION } from './config.mjs';
import { loadCredentials } from './credentials.mjs';
import { refreshCredentials } from './oauth.mjs';

const DEBUG = !!process.env.GEOLY_DEBUG;
const log = (...a) => DEBUG && console.error('[geoly-bridge]', ...a);

/** stdout 写一条 JSON-RPC 消息（newline-delimited，stdio MCP 传输格式）。 */
function writeMessage(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

/** 给带 id 的请求回一条 JSON-RPC error（通知无 id 则静默丢弃）。 */
function writeError(id, code, message) {
  if (id === undefined || id === null) return;
  writeMessage({ jsonrpc: '2.0', id, error: { code, message } });
}

/**
 * token 管理器：GEOLY_API_KEY 环境变量（geom_ 静态只读 token）优先；
 * 否则用 ~/.geoly/credentials 的 OAuth token，过期前 60s 或收到 401 时用 refresh_token 换新。
 * refresh 单飞（并发请求共享同一次刷新）。
 */
function createTokenManager() {
  const staticKey = process.env.GEOLY_API_KEY || null;
  let creds = staticKey ? null : loadCredentials();
  let refreshing = null;

  const doRefresh = () => {
    refreshing ??= refreshCredentials(creds)
      .then((next) => {
        creds = next;
        return next;
      })
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  };

  return {
    /** 是否走 GEOLY_API_KEY 静态轨（影响 401 提示文案）。 */
    isStatic: !!staticKey,
    /** 取当前可用 token；无凭据返回 null。 */
    async get() {
      if (staticKey) return staticKey;
      if (!creds) {
        creds = loadCredentials();
        if (!creds) return null;
      }
      if (creds.expires_at && creds.expires_at - Date.now() < 60_000 && creds.refresh_token) {
        try {
          await doRefresh();
        } catch (e) {
          log('proactive refresh failed:', e.message);
        }
      }
      return creds.access_token || null;
    },
    /** 收到 401 后强制刷新一次；成功返回新 token，失败返回 null。 */
    async forceRefresh() {
      if (staticKey || !creds?.refresh_token) return null;
      try {
        await doRefresh();
        return creds.access_token || null;
      } catch (e) {
        log('refresh after 401 failed:', e.message);
        return null;
      }
    },
  };
}

/**
 * 解析 SSE 响应体（服务端对 POST 可能回 text/event-stream），
 * 把每个 event 的 data 行拼起来 JSON.parse 后逐条写回 stdout。
 */
async function pumpSseBody(res) {
  const decoder = new TextDecoder();
  let buf = '';
  const flushEvent = (raw) => {
    const data = raw
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    try {
      writeMessage(JSON.parse(data));
    } catch {
      log('unparseable SSE data:', data.slice(0, 200));
    }
  };
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      flushEvent(buf.slice(0, idx));
      buf = buf.slice(idx + 2);
    }
  }
  if (buf.trim()) flushEvent(buf);
}

/**
 * stdio ↔ Streamable HTTP 桥主循环。
 * GEOly 的远程 MCP 是无状态 Streamable HTTP（仅 POST；GET/DELETE 返 405、无服务端推送），
 * 因此桥是纯请求-响应转发：stdin 每行一条 JSON-RPC → POST 远端 → 响应(JSON 或 SSE)写回 stdout。
 */
export async function runBridge() {
  const tokens = createTokenManager();
  let protocolVersion = null; // initialize 结果里记下，后续请求带 MCP-Protocol-Version 头

  const post = async (msg, token) => {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
      'X-Client-Name': CLIENT_NAME,
      'X-Client-Version': VERSION,
    };
    if (protocolVersion) headers['MCP-Protocol-Version'] = protocolVersion;
    return fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify(msg) });
  };

  const handle = async (msg) => {
    const id = msg?.id;
    let token = await tokens.get();
    if (!token) {
      writeError(
        id,
        -32002,
        'Not signed in to GEOly. Connect the GEOly connector (App Authorization → Connect), or run: npx -y @geoly/accio-mcp login'
      );
      return;
    }

    try {
      let res = await post(msg, token);

      // 401 → 强制 refresh 一次再重试；仍失败则提示重新授权
      if (res.status === 401) {
        token = await tokens.forceRefresh();
        if (token) res = await post(msg, token);
        if (!token || res.status === 401) {
          writeError(
            id,
            -32001,
            tokens.isStatic
              ? 'GEOLY_API_KEY was rejected (invalid or revoked geom_ token). Issue a new token in the GEOly dashboard.'
              : 'GEOly session expired. Reconnect the GEOly connector (App Authorization → Connect), or run: npx -y @geoly/accio-mcp login'
          );
          return;
        }
      }

      if (res.status === 202 || res.status === 204) return; // 通知已受理，无响应体

      const ctype = res.headers.get('content-type') || '';
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        writeError(id, -32000, `GEOly MCP HTTP ${res.status}: ${text.slice(0, 400)}`);
        return;
      }

      if (ctype.includes('text/event-stream')) {
        await pumpSseBody(res);
        return;
      }

      const body = await res.json();
      for (const m of Array.isArray(body) ? body : [body]) {
        // 记录协商出的协议版本，供后续请求头使用
        if (m?.result?.protocolVersion) protocolVersion = m.result.protocolVersion;
        writeMessage(m);
      }
    } catch (e) {
      writeError(id, -32001, `GEOly MCP transport error: ${e.message}`);
    }
  };

  // stdin 逐行读取（newline-delimited JSON-RPC）。
  // 在途请求计数：stdin 关闭时必须等全部响应写完再退出，否则管道式客户端会丢响应。
  let pending = 0;
  let stdinEnded = false;
  const maybeExit = () => {
    if (stdinEnded && pending === 0) process.exit(0);
  };
  const track = (msg) => {
    pending++;
    void handle(msg).finally(() => {
      pending--;
      maybeExit();
    });
  };

  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        log('unparseable stdin line:', line.slice(0, 200));
        continue;
      }
      track(msg);
    }
  });
  process.stdin.on('end', () => {
    stdinEnded = true;
    maybeExit();
  });

  log(`bridge started → ${MCP_URL}`);
  // 保持进程存活直到 stdin 关闭
  await new Promise(() => {});
}
