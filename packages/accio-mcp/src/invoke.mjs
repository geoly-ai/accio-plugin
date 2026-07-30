import { CLIENT_NAME, MCP_URL, VERSION } from './config.mjs';
import { createTokenManager } from './bridge.mjs';

// call/tools 子命令的默认客户端超时（服务端重型工具上限 ~45s，留足余量）
const INVOKE_TIMEOUT_MS = 120_000;

/**
 * 把 SSE 响应体一次性收集为 JSON-RPC 消息数组。
 * 与桥的 pumpSseBody（流式写回 stdout）相对，这里用于一次性调用后统一取结果。
 */
async function readSseMessages(res) {
  const decoder = new TextDecoder();
  const messages = [];
  let buf = '';
  const flushEvent = (raw) => {
    const data = raw
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    try {
      messages.push(JSON.parse(data));
    } catch {
      // 非 JSON 的 SSE 数据行（心跳等）忽略
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
  return messages;
}

/**
 * 一次性 JSON-RPC 调用：POST 远端（无状态 Streamable HTTP），
 * 复用桥的 token 管理（GEOLY_API_KEY 优先 / OAuth 过期刷新 / 401 强刷重试一次），
 * 兼容 JSON 与 SSE 两种响应格式，返回匹配请求 id 的 result；error 则抛出。
 */
async function rpcOnce(method, params, timeoutMs = INVOKE_TIMEOUT_MS) {
  const tokens = createTokenManager();
  let token = await tokens.get();
  if (!token) {
    throw new Error(
      'Not signed in to GEOly. Connect the GEOly connector (App Authorization → Connect), or run: geoly-accio-mcp login'
    );
  }

  const req = { jsonrpc: '2.0', id: 1, method, params };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const post = (tok) =>
    fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${tok}`,
        'X-Client-Name': CLIENT_NAME,
        'X-Client-Version': VERSION,
      },
      body: JSON.stringify(req),
      signal: ctl.signal,
    });

  try {
    let res = await post(token);
    if (res.status === 401) {
      token = await tokens.forceRefresh();
      if (token) res = await post(token);
      if (!token || res.status === 401) {
        throw new Error(
          tokens.isStatic
            ? 'GEOLY_API_KEY was rejected (invalid or revoked geom_ token). Issue a new token in the GEOly dashboard.'
            : 'GEOly session expired. Reconnect the GEOly connector (App Authorization → Connect), or run: geoly-accio-mcp login'
        );
      }
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GEOly MCP HTTP ${res.status}: ${text.slice(0, 400)}`);
    }
    const ctype = res.headers.get('content-type') || '';
    const body = ctype.includes('text/event-stream') ? await readSseMessages(res) : await res.json();
    const msgs = Array.isArray(body) ? body : [body];
    const m = msgs.find((x) => x?.id === req.id) ?? msgs[msgs.length - 1];
    if (m?.error) throw new Error(m.error.message || JSON.stringify(m.error));
    return m?.result;
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(
        `Timed out after ${Math.round(timeoutMs / 1000)}s. Heavy tools can be slow on first call — retry once (server cache warms up), or narrow the query (shorter date range / platform filter), or raise --timeout.`
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `geoly-accio-mcp tools`：列出当前账号可用的全部 GEOly 工具。
 * 默认每行一个（名称 + 描述首行），--json 输出完整 schema 供查参数。
 */
export async function runTools({ json = false, timeoutMs } = {}) {
  const result = await rpcOnce('tools/list', {}, timeoutMs);
  const tools = result?.tools || [];
  if (json) {
    console.log(JSON.stringify(tools, null, 2));
    return;
  }
  console.log(
    `${tools.length} GEOly tools available. Invoke: geoly-accio-mcp call <tool> --json '<args JSON>'  (--json '{}' if no args; add --schema via: geoly-accio-mcp tools --json)\n`
  );
  for (const t of tools) {
    const desc = (t.description || '').split('\n')[0];
    console.log(`${t.name}\t${desc.length > 110 ? `${desc.slice(0, 110)}…` : desc}`);
  }
}

/**
 * `geoly-accio-mcp call <tool> --json '<args>'`：一次性调用某个 GEOly 工具并打印结果。
 * 参数只收一个整体 JSON 对象（杜绝 flag 式传参的类型强转坑）；
 * 工具业务失败（isError）打到 stderr 并以退出码 1 结束。
 */
export async function runCall(name, argsJson, { timeoutMs } = {}) {
  let args = {};
  if (argsJson !== undefined) {
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      const err = new Error(`--json must be one valid JSON object, e.g. --json '{"time_range":"30d"}' (${e.message})`);
      err.exitCode = 2;
      throw err;
    }
  }
  const result = await rpcOnce('tools/call', { name, arguments: args }, timeoutMs);
  const texts = (result?.content || []).filter((c) => c?.type === 'text').map((c) => c.text);
  const out =
    texts.join('\n') ||
    (result?.structuredContent ? JSON.stringify(result.structuredContent, null, 2) : JSON.stringify(result ?? null));
  if (result?.isError) {
    console.error(out);
    process.exit(1);
  }
  console.log(out);
}
