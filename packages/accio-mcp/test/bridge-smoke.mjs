/**
 * 桥接冒烟测试（无外网依赖）：
 * 起一个本地 mock MCP 服务器，覆盖远端三种响应形态——application/json 单条、
 * text/event-stream 多事件、202 无体（通知）——断言桥都能正确转发/静默。
 * 运行：node packages/accio-mcp/test/bridge-smoke.mjs
 */
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.mjs');

/** mock 服务器：按请求的 method 字段决定响应形态。 */
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    assert.equal(req.url, '/api/mcp');
    assert.match(req.headers.authorization || '', /^Bearer geom_test/);
    const msg = JSON.parse(body);

    if (msg.method === 'initialize') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'mock' } },
        })
      );
    } else if (msg.method === 'tools/list') {
      // SSE 形态：两个事件（一条无关通知 + 真正的响应）
      assert.equal(req.headers['mcp-protocol-version'], '2025-03-26', 'protocol header expected');
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(
        'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/message","params":{"level":"info","data":"hi"}}\n\n'
      );
      res.write(
        `event: message\ndata: {"jsonrpc":"2.0","id":${msg.id},"result":{"tools":[{"name":"get_brand_overview"}]}}\n\n`
      );
      res.end();
    } else {
      // 通知 → 202 无体
      res.writeHead(202).end();
    }
  });
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const child = spawn(process.execPath, [CLI], {
  env: {
    ...process.env,
    GEOLY_BASE_URL: `http://127.0.0.1:${port}`,
    GEOLY_API_KEY: 'geom_test',
  },
  stdio: ['pipe', 'pipe', 'inherit'],
});

let out = '';
child.stdout.on('data', (c) => (out += c));

// 顺序发：initialize(json) → initialized 通知(202) → tools/list(sse)
child.stdin.write(
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}\n'
);
await new Promise((r) => setTimeout(r, 400));
child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
child.stdin.write('{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n');
await new Promise((r) => setTimeout(r, 400));
child.stdin.end();

const code = await new Promise((r) => child.on('close', r));
server.close();

const lines = out.trim().split('\n').map((l) => JSON.parse(l));
assert.equal(code, 0, 'bridge exits 0');
assert.equal(lines.length, 3, `expected 3 messages, got ${lines.length}: ${out}`);
assert.equal(lines[0].id, 1);
assert.equal(lines[0].result.protocolVersion, '2025-03-26');
assert.equal(lines[1].method, 'notifications/message'); // SSE 第一事件透传
assert.equal(lines[2].id, 2);
assert.equal(lines[2].result.tools[0].name, 'get_brand_overview');

console.log('bridge-smoke: all assertions passed (json / sse / 202 / protocol header / drain-exit)');
