import { clip } from "./agentTools.ts";

export type McpArgType = "string" | "number" | "integer" | "boolean";
export type McpTool = {
  name: string;
  description: string;
  properties: Record<string, McpArgType>;
  required: string[];
};

const PROTOCOL = "2025-06-18";
const MAX_TOOLS = 8;
const MAX_PROPERTIES = 12;
const MAX_RESPONSE_BYTES = 1_000_000;
const NAME = /^[\w.-]{1,64}$/;
const KEY = /^[\w.-]{1,40}$/;
const ARG_TYPES: readonly string[] = ["string", "number", "integer", "boolean"];

export function validateMcpUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Enter the full URL of the MCP server, starting with https://."); }
  if (url.username || url.password) throw new Error("Put credentials in the token field, never in the URL.");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    throw new Error("MCP servers must use https:// (plain http:// is allowed only for localhost).");
  return url;
}

/** Keeps only flat primitive arguments; anything else becomes a string. The model never sees an arbitrary server schema. */
export function simplifyTool(raw: unknown): McpTool | null {
  if (!raw || typeof raw !== "object") return null;
  const tool = raw as { name?: unknown; description?: unknown; inputSchema?: { properties?: unknown; required?: unknown } };
  if (typeof tool.name !== "string" || !NAME.test(tool.name)) return null;
  const properties: McpTool["properties"] = {};
  const declared = tool.inputSchema?.properties;
  if (declared && typeof declared === "object" && !Array.isArray(declared))
    for (const [key, spec] of Object.entries(declared).slice(0, MAX_PROPERTIES)) {
      if (!KEY.test(key)) continue;
      const type = (spec as { type?: unknown } | null)?.type;
      properties[key] = typeof type === "string" && ARG_TYPES.includes(type) ? (type as McpArgType) : "string";
    }
  const required = Array.isArray(tool.inputSchema?.required)
    ? (tool.inputSchema.required as unknown[]).filter((key): key is string => typeof key === "string" && Object.hasOwn(properties, key))
    : [];
  return { name: tool.name, description: clip(typeof tool.description === "string" ? tool.description.replace(/\s+/g, " ").trim() : "", 120), properties, required };
}

export function toolSchema(tool: McpTool): string {
  return JSON.stringify({
    type: "object",
    properties: Object.fromEntries(Object.entries(tool.properties).map(([key, type]) => [key, { type }])),
    required: tool.required,
    additionalProperties: false,
  });
}

export function checkArguments(tool: McpTool, args: Record<string, unknown>): Record<string, unknown> {
  for (const [key, value] of Object.entries(args)) {
    const type = Object.hasOwn(tool.properties, key) ? tool.properties[key] : undefined;
    if (!type) throw new Error(`The model supplied an unknown argument "${key}" for ${tool.name}. Nothing was sent.`);
    const ok = type === "integer" ? Number.isInteger(value) : typeof value === type;
    if (!ok) throw new Error(`Argument "${key}" for ${tool.name} must be a ${type}. Nothing was sent.`);
  }
  for (const key of tool.required)
    if (!Object.hasOwn(args, key)) throw new Error(`The model left out the required argument "${key}" for ${tool.name}. Nothing was sent.`);
  return args;
}

type Rpc = { id?: unknown; result?: unknown; error?: { message?: unknown } };

async function readEvents(response: Response, id: number): Promise<Rpc> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The MCP server sent an empty stream.");
  const decoder = new TextDecoder();
  let buffer = "";
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_RESPONSE_BYTES) throw new Error("The MCP server response was too large.");
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";
      for (const event of events) {
        const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        try {
          const message = JSON.parse(data) as Rpc;
          if (message.id === id) return message;
        } catch { /* ignore non-JSON events */ }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  throw new Error("The MCP server closed the stream without answering.");
}

export class McpClient {
  readonly url: URL;
  private token: string;
  private fetcher: typeof fetch;
  private session = "";
  private version = PROTOCOL;
  private counter = 1;

  constructor(url: string, token = "", fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.url = validateMcpUrl(url);
    this.token = token.trim();
    this.fetcher = fetcher;
  }

  private async send(method: string, params: unknown, signal: AbortSignal, notification = false): Promise<unknown> {
    const id = notification ? undefined : this.counter++;
    let response: Response;
    try {
      response = await this.fetcher(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          ...(this.session ? { "Mcp-Session-Id": this.session } : {}),
          ...(method === "initialize" ? {} : { "MCP-Protocol-Version": this.version }),
        },
        body: JSON.stringify({ jsonrpc: "2.0", ...(id === undefined ? {} : { id }), method, params }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
        redirect: "error",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
    } catch (failure) {
      if (signal.aborted) throw failure;
      throw new Error(`Could not reach the MCP server. It must be online and allow browser requests (CORS). ${failure instanceof Error ? failure.message : ""}`.trim());
    }
    if (notification) {
      await response.body?.cancel().catch(() => {});
      if (!response.ok) throw new Error(`The MCP server rejected ${method} (${response.status}).`);
      return null;
    }
    if (!response.ok) throw new Error(`The MCP server returned ${response.status}${response.status === 401 || response.status === 403 ? ". Check the token." : "."}`);
    this.session ||= response.headers.get("mcp-session-id") ?? "";
    const message: Rpc = (response.headers.get("content-type") ?? "").includes("text/event-stream")
      ? await readEvents(response, id!)
      : ((await response.json()) as Rpc);
    if (message.error) throw new Error(`MCP server error: ${clip(String(message.error.message ?? "unknown"), 200)}`);
    return message.result;
  }

  async connect(signal: AbortSignal): Promise<{ server: string; tools: McpTool[] }> {
    const init = (await this.send("initialize", {
      protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "technicalskills", version: "1" },
    }, signal)) as { protocolVersion?: unknown; serverInfo?: { name?: unknown } } | null;
    if (typeof init?.protocolVersion === "string" && /^\d{4}-\d{2}-\d{2}$/.test(init.protocolVersion)) this.version = init.protocolVersion;
    await this.send("notifications/initialized", {}, signal, true);
    const listed = (await this.send("tools/list", {}, signal)) as { tools?: unknown } | null;
    const tools = (Array.isArray(listed?.tools) ? listed.tools : []).map(simplifyTool).filter((tool): tool is McpTool => tool !== null).slice(0, MAX_TOOLS);
    return { server: clip(String(init?.serverInfo?.name ?? this.url.hostname), 60), tools };
  }

  async callTool(tool: McpTool, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
    checkArguments(tool, args);
    const result = (await this.send("tools/call", { name: tool.name, arguments: args }, signal)) as
      { content?: unknown; isError?: unknown } | null;
    const parts = (Array.isArray(result?.content) ? result.content : []).map((part: { type?: unknown; text?: unknown }) =>
      part.type === "text" && typeof part.text === "string" ? part.text : `[${String(part.type ?? "unknown")} content omitted]`);
    const text = parts.join("\n").trim() || "(the tool returned no text)";
    return clip(`${result?.isError ? "Tool reported an error: " : ""}${text}`, 1500);
  }
}
