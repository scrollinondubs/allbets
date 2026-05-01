export const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>allbets — cross-venue prediction-market discovery for AI agents</title>
  <meta name="description" content="One MCP endpoint. Three real-money prediction-market venues. Tell your agent your hypothesis, allbets tells you what is tradable, where the liquidity is, and what to watch for at settlement." />

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet" />

  <style>
    :root {
      --bg: #0a0d0a;
      --bg-elevated: #0f1410;
      --rule: #1c2820;
      --rule-strong: #2a3a2c;
      --text: #e8efe5;
      --text-muted: #7a8478;
      --text-dim: #4a504a;
      --accent: #5fff5f;
      --accent-dim: #2f8a2f;
      --warn: #ffb55a;
      --warn-dim: #8a5e2f;
      --serif: "Instrument Serif", "Iowan Old Style", Palatino, serif;
      --mono: "Geist Mono", "SF Mono", ui-monospace, monospace;
    }

    * { box-sizing: border-box; }

    html, body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--mono);
      font-size: 15px;
      line-height: 1.6;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background:
        radial-gradient(ellipse at top, rgba(95, 255, 95, 0.04), transparent 60%),
        radial-gradient(ellipse at bottom right, rgba(255, 181, 90, 0.025), transparent 50%);
      z-index: 0;
    }

    main {
      position: relative;
      z-index: 1;
      max-width: 720px;
      margin: 0 auto;
      padding: 64px 32px 96px;
    }

    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-family: var(--mono);
      font-size: 13px;
      color: var(--text-muted);
      letter-spacing: 0.02em;
      padding-bottom: 80px;
    }

    .topbar .brand {
      color: var(--text);
      font-weight: 600;
    }

    .topbar .brand::before {
      content: "▌ ";
      color: var(--accent);
    }

    .topbar .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .topbar .status::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 8px var(--accent);
      animation: pulse 2.4s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .hero {
      padding-bottom: 64px;
    }

    .hero .eyebrow {
      font-family: var(--mono);
      font-size: 12px;
      color: var(--accent);
      letter-spacing: 0.18em;
      text-transform: uppercase;
      margin-bottom: 20px;
    }

    .hero h1 {
      font-family: var(--serif);
      font-weight: 400;
      font-size: clamp(40px, 7vw, 64px);
      line-height: 1.04;
      letter-spacing: -0.015em;
      margin: 0 0 24px;
      color: var(--text);
    }

    .hero h1 em {
      font-style: italic;
      color: var(--accent);
    }

    .hero h1 .typed {
      display: inline;
    }

    .hero h1 .cursor {
      display: inline-block;
      width: 0.5ch;
      background: var(--accent);
      animation: blink 1s steps(1) infinite;
      margin-left: 2px;
      transform: translateY(2px);
    }

    @keyframes blink {
      50% { opacity: 0; }
    }

    .hero p.lede {
      font-family: var(--serif);
      font-size: 22px;
      line-height: 1.45;
      color: var(--text-muted);
      max-width: 60ch;
      margin: 0 0 36px;
    }

    .hero .cta-row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 20px;
      font-family: var(--mono);
      font-size: 13px;
      font-weight: 500;
      letter-spacing: 0.02em;
      text-decoration: none;
      border: 1px solid var(--rule-strong);
      color: var(--text);
      background: transparent;
      transition: border-color 0.15s, color 0.15s, background 0.15s;
    }
    .btn:hover { border-color: var(--accent); color: var(--accent); }
    .btn.primary { border-color: var(--accent); color: var(--accent); }
    .btn.primary:hover { background: var(--accent); color: var(--bg); }
    .btn::after { content: "→"; }

    hr.rule {
      border: 0;
      border-top: 1px solid var(--rule);
      margin: 64px 0;
    }

    section h2 {
      font-family: var(--serif);
      font-style: italic;
      font-weight: 400;
      font-size: 32px;
      line-height: 1.2;
      letter-spacing: -0.01em;
      margin: 0 0 24px;
      color: var(--text);
    }

    section h2 .num {
      font-family: var(--mono);
      font-style: normal;
      font-size: 12px;
      color: var(--accent);
      letter-spacing: 0.2em;
      vertical-align: top;
      margin-right: 12px;
    }

    section p {
      max-width: 60ch;
      color: var(--text);
      margin: 0 0 16px;
    }

    section p.muted { color: var(--text-muted); }

    .venue-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1px;
      background: var(--rule);
      border: 1px solid var(--rule);
      margin: 32px 0;
    }
    @media (max-width: 640px) {
      .venue-grid { grid-template-columns: 1fr; }
    }

    .venue {
      background: var(--bg-elevated);
      padding: 24px 20px;
    }

    .venue .name {
      font-family: var(--serif);
      font-style: italic;
      font-size: 24px;
      color: var(--text);
      margin-bottom: 8px;
    }

    .venue .vol {
      font-family: var(--mono);
      font-size: 22px;
      font-weight: 600;
      color: var(--accent);
      margin-bottom: 4px;
    }

    .venue .meta {
      font-family: var(--mono);
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.6;
    }

    .venue .tag {
      display: inline-block;
      font-size: 10px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      padding: 2px 6px;
      border: 1px solid var(--rule-strong);
      color: var(--text-muted);
      margin-top: 12px;
    }
    .venue .tag.us { color: var(--warn); border-color: var(--warn-dim); }
    .venue .tag.geo { color: var(--warn); border-color: var(--warn-dim); }
    .venue .tag.crypto { color: var(--accent); border-color: var(--accent-dim); }

    .feature-row {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 8px 24px;
      align-items: baseline;
      margin: 8px 0;
      padding-bottom: 12px;
      border-bottom: 1px dashed var(--rule);
    }
    .feature-row:last-child { border-bottom: 0; }

    .feature-row .label {
      font-family: var(--mono);
      font-size: 11px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--accent);
      white-space: nowrap;
    }

    .feature-row .body { color: var(--text); }

    pre.code {
      background: var(--bg-elevated);
      border: 1px solid var(--rule);
      border-left: 2px solid var(--accent);
      padding: 18px 20px;
      margin: 20px 0;
      overflow-x: auto;
      font-family: var(--mono);
      font-size: 13px;
      line-height: 1.65;
      color: var(--text);
    }
    pre.code .c { color: var(--text-muted); }
    pre.code .k { color: var(--accent); }
    pre.code .s { color: var(--warn); }

    .badge-demo {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 4px 10px;
      font-family: var(--mono);
      font-size: 11px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      border: 1px solid var(--warn-dim);
      color: var(--warn);
      background: rgba(255, 181, 90, 0.06);
    }
    .badge-demo::before {
      content: "▲";
      font-size: 10px;
    }

    footer {
      margin-top: 96px;
      padding-top: 32px;
      border-top: 1px solid var(--rule);
      font-family: var(--mono);
      font-size: 12px;
      color: var(--text-muted);
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;
    }
    footer a { color: var(--text-muted); text-decoration: none; border-bottom: 1px dotted var(--text-dim); }
    footer a:hover { color: var(--accent); border-color: var(--accent); }

    .reveal { opacity: 0; transform: translateY(8px); animation: reveal 0.6s ease forwards; }
    @keyframes reveal {
      to { opacity: 1; transform: translateY(0); }
    }
    .d1 { animation-delay: 0.4s; }
    .d2 { animation-delay: 0.6s; }
    .d3 { animation-delay: 0.8s; }
    .d4 { animation-delay: 1.0s; }
  </style>
</head>
<body>
  <main>
    <div class="topbar">
      <div class="brand">allbets</div>
      <div class="status">live · cf workers · v0.1.1</div>
    </div>

    <section class="hero">
      <div class="eyebrow reveal">Built at Agents Day Lisbon · 2026-05-01</div>
      <h1><span class="typed" id="typed"></span><span class="cursor">&nbsp;</span></h1>
      <p class="lede reveal d1">
        One <em>MCP endpoint</em>. Three real-money prediction-market venues. Tell your agent your hypothesis &mdash; allbets tells you what is tradable, where the liquidity is, and what to watch for at settlement.
      </p>
      <div class="cta-row reveal d2">
        <a class="btn primary" href="#try">Try the endpoint</a>
        <a class="btn" href="https://github.com/scrollinondubs/allbets" target="_blank" rel="noopener">View on GitHub</a>
      </div>
    </section>

    <hr class="rule" />

    <section>
      <h2><span class="num">01</span>The problem</h2>
      <p>
        Prediction markets crossed <strong>$27B in monthly volume</strong> in January 2026 &mdash; roughly five times the prior year. Three venues now dominate real-money flow: Kalshi, Polymarket, Limitless. They share almost nothing. Different identities. Different settlement models. Different jurisdictions. Different collateral tokens.
      </p>
      <p>
        An AI agent that wants to bet on a hypothesis has to know which venues even list the question, which it can legally trade on, where the liquidity actually is, and how badly settlement could surprise it. Today that is four separate API surfaces and a research afternoon.
      </p>

      <div class="venue-grid">
        <div class="venue">
          <div class="name">Kalshi</div>
          <div class="vol">$9.5B</div>
          <div class="meta">Jan 2026 volume<br />CFTC-regulated · USD<br />RSA-PSS auth · KYC required</div>
          <span class="tag us">US-only</span>
        </div>
        <div class="venue">
          <div class="name">Polymarket</div>
          <div class="vol">$3.3B</div>
          <div class="meta">Jan 2026 volume<br />Polygon CLOB · USDC.e<br />EIP-712 wallet auth</div>
          <span class="tag geo">Geo-blocked from US</span>
        </div>
        <div class="venue">
          <div class="name">Limitless</div>
          <div class="vol">$789M</div>
          <div class="meta">Jan 2026 volume<br />Base · USDC<br />Wallet + HMAC auth</div>
          <span class="tag crypto">Crypto-native</span>
        </div>
      </div>

      <p class="muted">
        Capital sits on three different chains. None of it is fungible. A US agent cannot trade Polymarket-international. A non-US agent cannot trade Kalshi. Most of these facts are not visible from any single venue&apos;s docs.
      </p>
    </section>

    <hr class="rule" />

    <section>
      <h2><span class="num">02</span>What allbets does</h2>
      <p>
        One MCP endpoint over <strong>Streamable HTTP</strong>. Five tools. Read-only. Public APIs only. No keys at runtime.
      </p>

      <div class="feature-row">
        <div class="label">pm_discover</div>
        <div class="body">Hand it a hypothesis and a jurisdiction. Returns what each venue lists, the depth of liquidity, the resolution model, and a single recommended trade-here URL. The primary entry tool.</div>
      </div>
      <div class="feature-row">
        <div class="label">pm_quote</div>
        <div class="body">Single-market deep-dive with the <em>settlement-risk badge</em>. Pass a Polymarket / Kalshi / Limitless URL or a <code>venue:id</code> shorthand. Returns the full normalized market plus UMA dispute window, bond, and resolution status. The trust shape behind the price.</div>
      </div>
      <div class="feature-row">
        <div class="label">pm_disputes_active</div>
        <div class="body">Polymarket markets currently UMA-flagged (proposed-but-not-finalized or actively disputed). Polymarket flipped over $30M of supposedly-final resolutions in 2025. Every other MCP shows the stale number; this one surfaces the risk.</div>
      </div>
      <div class="feature-row">
        <div class="label">pm_search</div>
        <div class="body">Raw cross-venue search. Less curated. Useful when you want the full set rather than the best match.</div>
      </div>
      <div class="feature-row">
        <div class="label">pm_list_active</div>
        <div class="body">Most active markets per venue, ranked by volume. For browsing.</div>
      </div>
      <div class="feature-row">
        <div class="label">settlement risk</div>
        <div class="body">Every quote carries <code>settlement_risk: low | moderate | high</code> with a human-readable reason. Computed uniformly for all venues. UMA dispute windows, bond size, and resolution-rule thinness all feed in. The agent capability that didn&apos;t exist before.</div>
      </div>
    </section>

    <hr class="rule" />

    <section>
      <h2><span class="num">03</span>What it deliberately is not</h2>
      <p>
        allbets is the <em>information</em> primitive. Not the execution primitive.
      </p>
      <p class="muted">
        Trading across these venues is hard for reasons that have nothing to do with API plumbing. Three incompatible auth models. KYC versus wallet. Capital fragmentation across chains and clearinghouses. Settlement windows that range from seconds (Kalshi) to days (Polymarket UMA disputes). MCP is the wrong shape for orchestrating that.
      </p>
      <p class="muted">
        Trade execution stays with the agent&apos;s existing per-venue tools: Polymarket Agents, Olas Polystrat, shaanmajid&apos;s prediction-mcp. allbets answers <em>where</em>. They answer <em>place</em>.
      </p>
    </section>

    <hr class="rule" />

    <section id="try">
      <h2><span class="num">04</span>Try it</h2>
      <p>The MCP endpoint is live now at <strong>https://allbets.dev/mcp</strong>. JSON-RPC 2.0 over HTTP POST.</p>

      <pre class="code"><span class="c"># list tools</span>
<span class="k">curl</span> -X POST https://allbets.dev/mcp \\
  -H <span class="s">"Content-Type: application/json"</span> \\
  -d <span class="s">'{"jsonrpc":"2.0","id":1,"method":"tools/list"}'</span>

<span class="c"># discover what is tradable on a hypothesis</span>
<span class="k">curl</span> -X POST https://allbets.dev/mcp \\
  -H <span class="s">"Content-Type: application/json"</span> \\
  -d <span class="s">'{
    "jsonrpc":"2.0","id":1,"method":"tools/call",
    "params":{
      "name":"pm_discover",
      "arguments":{
        "hypothesis":"Powell cuts rates in June",
        "jurisdiction":"non_us"
      }
    }
  }'</span></pre>

      <p class="muted" style="margin-top: 24px;">
        <span class="badge-demo">Live</span>
        &nbsp;Hitting public Polymarket, Kalshi, and Limitless APIs in parallel from the Cloudflare edge. No auth. ~300ms typical roundtrip from Lisbon.
      </p>
    </section>

    <hr class="rule" />

    <section>
      <h2><span class="num">05</span>Connect from Claude Desktop</h2>
      <p>Claude Desktop only speaks stdio natively, so we bridge through <code>mcp-remote</code>. Add to <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>:</p>

      <pre class="code">{
  <span class="k">"mcpServers"</span>: {
    <span class="k">"allbets"</span>: {
      <span class="k">"command"</span>: <span class="s">"npx"</span>,
      <span class="k">"args"</span>: [<span class="s">"-y"</span>, <span class="s">"mcp-remote@latest"</span>, <span class="s">"https://allbets.dev/mcp"</span>]
    }
  }
}</pre>

      <p class="muted">Restart Claude Desktop. Ask: &ldquo;What does the market think about a Fed rate cut in June?&rdquo;</p>
      <p class="muted"><strong>Cursor / Claude Code / any HTTP-native MCP client</strong> can hit <code>https://allbets.dev/mcp</code> directly without the shim — the proxy is a Claude Desktop limitation, not a server one.</p>
    </section>

    <hr class="rule" />

    <section>
      <h2><span class="num">06</span>The code</h2>
      <p>
        Open-source under MIT at <a href="https://github.com/scrollinondubs/allbets" style="color: var(--accent); text-decoration: none; border-bottom: 1px dotted var(--accent-dim);" target="_blank" rel="noopener">github.com/scrollinondubs/allbets</a>. TypeScript. Cloudflare Workers + Hono. ~600 lines including all three adapters.
      </p>
      <p class="muted">
        Pull requests welcome. New venue? Implement <code>VenueAdapter</code> in <code>src/adapters/</code>. New tool? Add it to <code>src/tools.ts</code>. The matcher is in <code>src/matcher.ts</code> and is intentionally simple right now &mdash; an LLM-judge upgrade is queued for v0.2.
      </p>
    </section>

    <footer>
      <div>built at agents day lisbon · 2026-05-01 · marc johnson + sean tierney + jax</div>
      <div>
        <a href="https://github.com/scrollinondubs/allbets" target="_blank" rel="noopener">github</a>
        &nbsp;·&nbsp;
        <a href="/mcp">/mcp</a>
        &nbsp;·&nbsp;
        <a href="/health">/health</a>
      </div>
    </footer>
  </main>

  <script>
    (function() {
      var phrases = [
        "Where can my agent ",
        "<em>actually</em> place this bet?"
      ];
      var target = document.getElementById("typed");
      if (!target) return;
      var full = phrases.join("");
      var i = 0;
      function tick() {
        if (i > full.length) return;
        target.innerHTML = full.slice(0, i);
        i += 1;
        setTimeout(tick, 32 + Math.random() * 24);
      }
      setTimeout(tick, 250);
    })();
  </script>
</body>
</html>`;
