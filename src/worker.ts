import { Hono } from "hono";
import { z } from "zod";
import { TOOL_DEFS, runTool } from "./tools.js";
import { LANDING_HTML } from "./landing.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface WorkersAIBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

interface WorkerEnv {
  FIRECRAWL_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  EXA_API_KEY?: string;
  AI?: WorkersAIBinding;
}

const app = new Hono<{ Bindings: WorkerEnv }>();

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
        return respond({
          content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
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

app.notFound((c) => c.json({ error: "not_found", path: c.req.path }, 404));

export default app;
