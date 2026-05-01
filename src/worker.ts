import { Hono } from "hono";
import { agentsMiddleware } from "hono-agents";
import { z } from "zod";
import { TOOL_DEFS, runTool } from "./tools.js";
import { LANDING_HTML } from "./landing.js";

// Re-export agent classes so wrangler can bind them as Durable Objects
export { RecommendAgent } from "./agents/recommend-agent.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface WorkersAIBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

interface DurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch: (request: Request) => Promise<Response>; recommend?: (...args: unknown[]) => Promise<unknown> };
}

interface WorkerEnv {
  FIRECRAWL_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  EXA_API_KEY?: string;
  XAI_API_KEY?: string;
  POLYMARKET_REF_CODE?: string;
  KALSHI_REF_CODE?: string;
  LIMITLESS_REF_CODE?: string;
  OPENAI_API_KEY?: string;
  AI?: WorkersAIBinding;
  RecommendAgent?: DurableObjectNamespace;
}

const app = new Hono<{ Bindings: WorkerEnv }>();

// Cloudflare Agents middleware — handles /agents/* routes for HTTP and WebSocket
// access to Agent Durable Objects. Lets external agents talk to RecommendAgent
// without going through the MCP layer.
app.use("/agents/*", agentsMiddleware());

app.get("/", (c) =>
  c.html(LANDING_HTML, 200, {
    "cache-control": "public, max-age=60",
  }),
);

app.get("/info", (c) =>
  c.json({
    name: "allbets-mcp",
    version: "0.1.7",
    description:
      "Cross-venue prediction-market discovery. Tells your agent what bet exists across Polymarket, Kalshi, and Limitless and where to place it.",
    mcp_endpoint: "/mcp",
    tools: TOOL_DEFS.map((t) => t.name),
    docs: "https://github.com/scrollinondubs/allbets",
  }),
);

app.get("/health", (c) => c.json({ status: "ok", ts: new Date().toISOString() }));

app.get("/mcp", (c) =>
  c.json({
    transport: "JSON-RPC over HTTP POST",
    methods: ["initialize", "tools/list", "tools/call", "ping"],
    schema: "https://spec.modelcontextprotocol.io/specification/2024-11-05/",
  }),
);

app.post("/mcp", async (c) => {
  let body: JsonRpcRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      400,
    );
  }

  const id = body.id ?? null;

  const respond = (result: unknown) =>
    c.json({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string, data?: unknown) =>
    c.json({ jsonrpc: "2.0", id, error: { code, message, data } });

  try {
    switch (body.method) {
      case "initialize":
        return respond({
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "allbets-mcp", version: "0.1.1" },
        });
      case "ping":
        return respond({});
      case "tools/list":
        return respond({ tools: TOOL_DEFS });
      case "tools/call": {
        const params = body.params ?? {};
        const name = params.name as string;
        const args = (params.arguments as Record<string, unknown>) ?? {};
        const { value, isError } = await runTool(name, args, c.env);
        const imageBlocks = await collectImageBlocks(value);
        return respond({
          content: [
            { type: "text", text: JSON.stringify(value, null, 2) },
            ...imageBlocks,
          ],
          isError,
        });
      }
      default:
        return fail(-32601, `Method not found: ${body.method}`);
    }
  } catch (err) {
    // Per JSON-RPC 2.0: -32602 for invalid params (Zod validation), -32603 for
    // internal errors. MCP clients (Claude Desktop, etc.) surface these
    // distinctly to the agent so it can self-correct invalid arguments.
    if (err instanceof z.ZodError) {
      return fail(-32602, "Invalid params", err.errors);
    }
    return fail(-32603, err instanceof Error ? err.message : String(err));
  }
});

// Walk an arbitrary tool-result value, collect image_url strings, fetch each
// URL, base64-encode, return as MCP `image` content blocks. This is what
// makes inline image rendering work in Claude Desktop / Cursor / any MCP
// client that follows the spec — text content blocks containing image URLs
// are rendered as text, only `{ type: "image", data, mimeType }` blocks
// render inline.
async function collectImageBlocks(
  value: unknown,
): Promise<Array<{ type: "image"; data: string; mimeType: string }>> {
  const urls: string[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (typeof obj.image_url === "string" && !seen.has(obj.image_url)) {
      seen.add(obj.image_url);
      urls.push(obj.image_url);
    }
    for (const k of Object.keys(obj)) {
      if (k === "raw") continue; // skip the raw venue payload
      walk(obj[k]);
    }
  };
  walk(value);
  if (urls.length === 0) return [];

  const fetched = await Promise.allSettled(
    urls.map(async (url) => {
      // skip data: URLs — already base64
      if (url.startsWith("data:")) {
        const match = url.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) return null;
        return { data: match[2]!, mimeType: match[1]! };
      }
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      const b64 = arrayBufferToBase64(buf);
      const mimeType = res.headers.get("content-type") ?? "image/png";
      return { data: b64, mimeType: mimeType.split(";")[0]!.trim() };
    }),
  );

  const blocks: Array<{ type: "image"; data: string; mimeType: string }> = [];
  for (const r of fetched) {
    if (r.status === "fulfilled" && r.value) {
      blocks.push({ type: "image", ...r.value });
    }
  }
  return blocks;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

app.notFound((c) => c.json({ error: "not_found", path: c.req.path }, 404));

export default app;
