import { test } from "node:test";
import assert from "node:assert/strict";
import { McpClient, checkArguments, simplifyTool, toolSchema, validateMcpUrl } from "../src/mcp.ts";

const signal = () => new AbortController().signal;
const json = (body, headers = {}) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json", ...headers } });
const sse = (...messages) => new Response(messages.map((m) => `event: message\ndata: ${JSON.stringify(m)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });

function server(handlers) {
  const calls = [];
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), init, body });
    return handlers[body.method](body, init, calls);
  };
  return { calls, fetcher };
}

const tools = [
  { name: "search_docs", description: "  Search\nthe docs  ".padEnd(300, "x"), inputSchema: { properties: { query: { type: "string" }, limit: { type: "integer" }, filter: { type: "object" }, "bad key!": { type: "string" } }, required: ["query", "missing", 5] } },
  { name: "bad name!", description: "x" }, null, "x", { name: "no_args" },
];

test("server URLs must be https (or localhost), without embedded credentials", () => {
  assert.equal(validateMcpUrl(" https://mcp.example.com/mcp ").hostname, "mcp.example.com");
  assert.equal(validateMcpUrl("http://localhost:3000/mcp").port, "3000");
  assert.equal(validateMcpUrl("http://127.0.0.1/mcp").hostname, "127.0.0.1");
  assert.equal(validateMcpUrl("http://[::1]:8080/").hostname, "[::1]");
  for (const bad of ["", "mcp.example.com", "http://mcp.example.com", "ftp://x.com", "https://user:pw@x.com/", "https://:pw@x.com/", "javascript:alert(1)", "file:///etc/passwd"])
    assert.throws(() => validateMcpUrl(bad), undefined, bad);
});

test("tool definitions are reduced to flat primitive arguments the model can fill safely", () => {
  const [search] = tools.map(simplifyTool);
  assert.deepEqual(search.properties, { query: "string", limit: "integer", filter: "string" });
  assert.deepEqual(search.required, ["query"]);
  assert.ok(search.description.length <= 120);
  assert.deepEqual(tools.map(simplifyTool).map((tool) => tool?.name ?? null), ["search_docs", null, null, null, "no_args"]);
  assert.deepEqual(JSON.parse(toolSchema(search)), {
    type: "object", properties: { query: { type: "string" }, limit: { type: "integer" }, filter: { type: "string" } },
    required: ["query"], additionalProperties: false,
  });
  assert.deepEqual(JSON.parse(toolSchema(simplifyTool({ name: "no_args" }))).properties, {});
  const many = simplifyTool({ name: "wide", inputSchema: { properties: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`p${i}`, { type: "string" }])) } });
  assert.equal(Object.keys(many.properties).length, 12);
});

test("arguments are validated against the simplified schema before anything is sent", () => {
  const tool = simplifyTool(tools[0]);
  assert.deepEqual(checkArguments(tool, { query: "x", limit: 3 }), { query: "x", limit: 3 });
  for (const bad of [{}, { query: 5 }, { query: "x", limit: 1.5 }, { query: "x", extra: 1 }, { query: "x", limit: "3" }, { query: "x", __proto__x: 1 }])
    assert.throws(() => checkArguments(tool, bad), /Nothing was sent/, JSON.stringify(bad));
});

test("connect negotiates, lists tools over JSON, carries the session, and sends the token only as a header", async () => {
  const { calls, fetcher } = server({
    initialize: () => json({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-03-26", serverInfo: { name: "Docs" } } }, { "mcp-session-id": "sess-1" }),
    "notifications/initialized": () => new Response(null, { status: 202 }),
    "tools/list": () => json({ jsonrpc: "2.0", id: 2, result: { tools } }),
  });
  const client = new McpClient("https://mcp.example.com/mcp", " secret-token ", fetcher);
  const connected = await client.connect(signal());
  assert.equal(connected.server, "Docs");
  assert.deepEqual(connected.tools.map((tool) => tool.name), ["search_docs", "no_args"]);
  assert.deepEqual(calls.map((call) => call.body.method), ["initialize", "notifications/initialized", "tools/list"]);
  assert.equal("id" in calls[1].body, false);
  assert.equal(calls[0].init.headers["Mcp-Session-Id"], undefined);
  assert.equal(calls[0].init.headers["MCP-Protocol-Version"], undefined);
  for (const call of calls.slice(1)) {
    assert.equal(call.init.headers["Mcp-Session-Id"], "sess-1");
    assert.equal(call.init.headers["MCP-Protocol-Version"], "2025-03-26");
  }
  for (const call of calls) {
    assert.equal(call.init.headers.Authorization, "Bearer secret-token");
    assert.equal(call.url, "https://mcp.example.com/mcp");
    assert.equal(call.init.redirect, "error");
    assert.equal(call.init.credentials, "omit");
    assert.equal(call.init.referrerPolicy, "no-referrer");
    assert.doesNotMatch(call.init.body ?? "", /secret-token/);
  }
  assert.equal(new McpClient("https://mcp.example.com/mcp", "", fetcher).url.href, "https://mcp.example.com/mcp");
});

test("tool calls work over event streams, flag errors, omit non-text content and are bounded", async () => {
  const answers = [];
  const { calls, fetcher } = server({
    initialize: () => json({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } }),
    "notifications/initialized": () => new Response(null, { status: 202 }),
    "tools/list": () => sse({ jsonrpc: "2.0", method: "notifications/progress" }, { jsonrpc: "2.0", id: 2, result: { tools } }),
    "tools/call": () => sse({ jsonrpc: "2.0", id: 99, result: { content: [{ type: "text", text: "wrong id" }] } }, answers.shift()),
  });
  const client = new McpClient("https://mcp.example.com/mcp", "", fetcher);
  const { tools: listed, server: name } = await client.connect(signal());
  assert.equal(name, "mcp.example.com");
  const tool = listed[0];
  answers.push({ jsonrpc: "2.0", id: 3, result: { content: [{ type: "text", text: "line one" }, { type: "image", data: "AAAA" }, { type: "text", text: "x".repeat(5000) }] } });
  const text = await client.callTool(tool, { query: "auth" }, signal());
  assert.match(text, /^line one\n\[image content omitted\]\nx+…$/);
  assert.ok(new TextEncoder().encode(text).length <= 1500);
  assert.deepEqual(calls.at(-1).body.params, { name: "search_docs", arguments: { query: "auth" } });
  answers.push({ jsonrpc: "2.0", id: 4, result: { isError: true, content: [{ type: "text", text: "no such page" }] } });
  assert.equal(await client.callTool(tool, { query: "z" }, signal()), "Tool reported an error: no such page");
  answers.push({ jsonrpc: "2.0", id: 5, result: { content: [] } });
  assert.equal(await client.callTool(tool, { query: "z" }, signal()), "(the tool returned no text)");
  const before = calls.length;
  await assert.rejects(client.callTool(tool, { query: 7 }, signal()), /must be a string. Nothing was sent/);
  assert.equal(calls.length, before);
});

test("server errors, bad status, closed streams, oversized streams and unreachable servers fail clearly", async () => {
  const failing = (handler) => new McpClient("https://mcp.example.com/mcp", "", async () => handler());
  await assert.rejects(failing(() => json({ jsonrpc: "2.0", id: 1, error: { code: -1, message: "x".repeat(500) } })).connect(signal()), /^Error: MCP server error: x+…$/);
  await assert.rejects(failing(() => new Response("no", { status: 401 })).connect(signal()), /returned 401. Check the token/);
  await assert.rejects(failing(() => new Response("no", { status: 500 })).connect(signal()), /returned 500\.$/);
  await assert.rejects(failing(() => new Response("event: ping\ndata: {}\n\n", { headers: { "content-type": "text/event-stream" } })).connect(signal()), /closed the stream without answering/);
  await assert.rejects(failing(() => new Response("x".repeat(1_100_000), { headers: { "content-type": "text/event-stream" } })).connect(signal()), /too large/);
  await assert.rejects(failing(() => { throw new TypeError("Failed to fetch"); }).connect(signal()), /allow browser requests \(CORS\)/);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(new McpClient("https://mcp.example.com/mcp", "", async (_, init) => { init.signal.throwIfAborted(); }).connect(abort.signal), { name: "AbortError" });
  assert.throws(() => new McpClient("http://evil.example.com/mcp"), /https/);
});
