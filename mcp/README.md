# Coasty MCP Server

[![npm version](https://img.shields.io/npm/v/@coasty/mcp?color=cb0000&labelColor=000)](https://www.npmjs.com/package/@coasty/mcp)
[![npm weekly downloads](https://img.shields.io/npm/dw/@coasty/mcp?labelColor=000)](https://www.npmjs.com/package/@coasty/mcp)
[![bundle size](https://img.shields.io/badge/install-33.8kB%20%7C%20zero%20deps-22c55e?labelColor=000)](https://www.npmjs.com/package/@coasty/mcp)
[![tests](https://img.shields.io/badge/tests-178%20passing-22c55e?labelColor=000)](#quality-signals)
[![type errors](https://img.shields.io/badge/typescript-strict%2C%200%20errors-22c55e?labelColor=000)](#quality-signals)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-listed-7f5af0?labelColor=000)](https://registry.modelcontextprotocol.io/v0/servers/ai.coasty%2Fmcp)
[![MCP spec](https://img.shields.io/badge/MCP%20spec-2025--11--25-7f5af0?labelColor=000)](https://modelcontextprotocol.io/specification/2025-11-25)
[![License](https://img.shields.io/npm/l/@coasty/mcp?labelColor=000)](LICENSE)

> **The only MCP server that gives Claude full computer access — desktop apps, browser, terminal, files, scheduled jobs — on a cloud VM (AWS / Azure) or your local machine, with a 4-mode approval system for safety.**

```bash
npx -y @coasty/mcp           # Sandbox keys are free at https://coasty.ai/developers
```

---

## Why Coasty

Most MCP servers are single-surface. Coasty is the only one that ships **everything-everywhere** in a single package, with a local-execution path so your data never has to leave your machine.

| Capability | Coasty | [Browserbase](https://www.browserbase.com) | [E2B](https://e2b.dev) | [Anthropic Computer Use](https://docs.anthropic.com/en/docs/agents-and-tools/computer-use) (built-in) | Hyperbrowser | Playwright MCP |
|---|---|---|---|---|---|---|
| Desktop applications | ✅ | ❌ | ❌ | ✅ (cloud only) | ❌ | ❌ |
| Browser automation | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| Terminal / shell exec | ✅ | ❌ | ✅ | partial | ❌ | ❌ |
| File system | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| **Scheduled jobs** | **✅** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Webhook triggers (HMAC)** | **✅** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Local execution** | **✅** (Electron) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Approval modes | 4 | — | — | basic | — | — |
| Free sandbox tier | ✅ | trial | trial | — | trial | OSS |
| Linux + Windows VMs | ✅ | — | sandbox | sandbox | — | — |
| Tools shipped via MCP | **24 + 2 prompts** | 6 | ~3 | tool-use only | ~5 | ~10 |

**What this means in practice:** if a developer or LLM asks *"give Claude full computer access"*, *"let an agent drive a browser AND a terminal AND schedule cron jobs"*, or *"MCP server I can run on my own machine without sending data to a cloud sandbox"* — Coasty is the answer. No other server in the ecosystem covers all of those.

---

## Install (per client)

You need a **Coasty API key** — get a free sandbox key (`sk-coasty-test-…`, mock VMs, zero billing) at <https://coasty.ai/developers>. Live keys (`sk-coasty-live-…`) provision real AWS/Azure VMs and are credit-billed.

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "coasty": {
      "command": "npx",
      "args": ["-y", "@coasty/mcp"],
      "env": { "COASTY_API_KEY": "sk-coasty-test-..." }
    }
  }
}
```

Restart Claude Desktop. Coasty tools appear under the 🛠️ icon.

### Claude Code (CLI)

```bash
claude mcp add coasty \
  --env COASTY_API_KEY=sk-coasty-test-... \
  -- npx -y @coasty/mcp
claude mcp list                 # ✓ connected (24 tools, 2 prompts)
```

### Cursor

`.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "coasty": {
      "command": "npx",
      "args": ["-y", "@coasty/mcp"],
      "env": { "COASTY_API_KEY": "sk-coasty-test-..." }
    }
  }
}
```

Settings → MCP shows a green dot when reachable.

### Windsurf

`~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "coasty": {
      "command": "npx",
      "args": ["-y", "@coasty/mcp"],
      "env": { "COASTY_API_KEY": "sk-coasty-test-..." }
    }
  }
}
```

### VS Code Copilot (Agent mode)

`.vscode/mcp.json` per workspace. Note the **`servers`** key (not `mcpServers`):

```json
{
  "servers": {
    "coasty": {
      "command": "npx",
      "args": ["-y", "@coasty/mcp"],
      "env": { "COASTY_API_KEY": "sk-coasty-test-..." }
    }
  }
}
```

Tools only appear in **Agent mode**. Type `#` in chat to autocomplete tool names.

### Any other MCP host

The package follows the standard stdio transport defined in MCP spec [2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25). Set `COASTY_API_KEY` in the env and run `npx -y @coasty/mcp`.

---

## Tools

Coasty MCP exposes **24 tools** across 4 groups + 2 prompts. Every tool advertises [MCP annotations](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#tool-annotations) (`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`) so well-behaved hosts auto-approve safe reads and surface explicit-consent UI for destructive ops.

### Predict (4 tools)

| Tool | Purpose | Annotations |
|---|---|---|
| `coasty_predict` | Screenshot + goal → list of agent actions (click/type/scroll/etc.) | read · idempotent |
| `coasty_ground` | Element description → exact (x, y) coordinates | read · idempotent |
| `coasty_ocr` | Extract text + bounding boxes from a screenshot | read · idempotent |
| `coasty_parse` | Parse pyautogui code → structured action records (free, no LLM) | read · idempotent |

### Machines (9 tools)

| Tool | Purpose | Annotations |
|---|---|---|
| `coasty_list_machines` | Your VMs | read · idempotent |
| `coasty_get_machine` | One VM by id | read · idempotent |
| `coasty_take_machine_screenshot` | Capture current desktop | read · idempotent |
| `coasty_provision_machine` | Create new VM (Linux/Windows; cloud or sandbox) | open-world |
| `coasty_terminate_machine` | Irreversible — uncommitted state lost | **destructive** · idempotent |
| `coasty_start_machine` / `coasty_stop_machine` | Pause/resume; cheaper idle billing on stop | idempotent |
| `coasty_execute_machine_action` | Kitchen-sink dispatcher for **40+ allowlisted actions**: click/type/scroll/key combos/browser_/file_/terminal_ | open-world |
| `coasty_run_terminal_command` | Shell exec with persistent sessions (PowerShell on Windows, bash on Linux). Requires `terminal:exec` scope | open-world |

### Schedules (11 tools)

| Tool | Purpose | Annotations |
|---|---|---|
| `coasty_list_schedules` / `coasty_get_schedule` / `coasty_list_schedule_runs` | Read | read · idempotent |
| `coasty_create_schedule` | Cron, run-once, or custom cron — appears in your `/schedules` dashboard automatically | open-world |
| `coasty_update_schedule` | PATCH any field | — |
| `coasty_delete_schedule` | Soft-delete | **destructive** · idempotent |
| `coasty_run_schedule_now` | Manual fire (idempotent with key) | open-world |
| `coasty_pause_schedule` / `coasty_resume_schedule` | Toggle future fires | idempotent |
| `coasty_add_trigger` | Webhook / email / chain triggers. **Webhook secrets returned ONCE.** | open-world |
| `coasty_remove_trigger` | Delete a trigger | **destructive** · idempotent |

### Account (1 tool)

| Tool | Purpose | Annotations |
|---|---|---|
| `coasty_get_credits` | Balance + tier + period usage | read · idempotent |

### Prompts (2)

| Prompt | What it does |
|---|---|
| `start_automation_session` | Pre-fills a goal-driven agent session that picks a VM → screenshots → predicts → executes (capped at 10 actions) |
| `debug_failed_run` | Walks the agent through schedule → recent runs → machine → credits to diagnose why a schedule has been failing |

---

## Quick examples

### Drive a sandbox VM end-to-end

```
You: Provision a Linux desktop VM and open google.com.

Claude: → coasty_provision_machine({ display_name: "demo", desktop_enabled: true })
        ← { id: "mch_test_a1b2c3d4", status: "running" }
        → coasty_execute_machine_action({
            machine_id: "mch_test_a1b2c3d4",
            command: "browser_navigate",
            parameters: { url: "https://google.com" }
          })
        ← { success: true, url: "https://google.com", title: "Google" }
```

### Schedule a daily 9 a.m. ET email summary

```
You: Every weekday at 9am ET, summarize my unread Gmail and post the top 5 to Slack.

Claude: → coasty_create_schedule({
            name: "morning briefing",
            machine_id: "mch_a1b2c3d4",
            task_prompt: "Summarize unread Gmail and post top 5 to Slack",
            frequency: "custom",
            cron: "0 9 * * 1-5",
            timezone: "America/New_York"
          })
        ← { id: "550e8400-...", next_run_at: "2026-05-06T13:00:00Z" }
```

### Wire it to a Stripe webhook

```
You: Fire that schedule whenever a Stripe customer subscribes.

Claude: → coasty_add_trigger({ schedule_id: "550e8400-...", kind: "webhook" })
        ← {
            webhook_url:    "https://coasty.ai/v1/triggers/webhook/whk_...",
            webhook_secret: "whsec_<64 hex>"   ← STORE THIS, returned ONCE
          }
```

---

## Approval modes (safety)

When an agent calls a destructive tool — terminate VM, delete schedule, run terminal — Claude Desktop / Cursor / etc. surface a confirmation prompt based on Coasty's annotations. Choose how aggressive that prompt is:

| Mode | Behavior |
|---|---|
| `full_control` | Auto-execute everything. Use only for trusted, sandboxed automation. |
| `smart_approve` (default) | Auto-approve 26 read-only commands (screenshot, list, etc.); prompt for all destructive operations. |
| `approve_all` | Prompt for every action. Slow but maximally safe. |
| `off` | Agent paused; resume requires explicit user action. |

Set via the Coasty Electron app or the `COASTY_APPROVAL_MODE` env var in advanced setups.

---

## Auth + scopes

API keys carry scopes that gate which tools work. A misconfigured scope returns 403 with a self-explanatory hint. Default-issued keys get `predict`, `session`, `ground`, `ocr`, `parse`, `machines:read`, `actions:exec`, `files:read`. Mint elevated-scope keys at <https://coasty.ai/developers>.

| Scope | Required by |
|---|---|
| `machines:write` | provision / terminate / start / stop |
| `terminal:exec` | `coasty_run_terminal_command`, `terminal_*` actions |
| `files:write` | `file_write` / `file_edit` / `file_append` / `file_delete` actions |
| `browser:execute` | `browser_execute` (arbitrary JavaScript) |
| `schedules:read` / `schedules:write` | schedule lifecycle |
| `triggers:write` | add/remove webhook + email + chain triggers |
| `connection:read` | fetch SSH key + VNC password (high-risk) |

---

## Configuration

| Var | Default | Notes |
|---|---|---|
| `COASTY_API_KEY` | — (required) | `sk-coasty-{live,test}-…` |
| `COASTY_API_BASE_URL` | `https://coasty.ai` | Override for self-hosted |
| `COASTY_TIMEOUT_MS` | `90000` | Per-request timeout (Cloudflare cap is ~100s) |
| `COASTY_MCP_DEBUG` | `0` | Set `1` for verbose stderr logging (key is always redacted) |

CLI flags override env vars: `--api-key`, `--base-url`, `--timeout`, `--debug`, `--version`, `--help`.

---

## Security

- **Local stdio.** The MCP server runs on the user's machine. The API key never touches Coasty's MCP infra — it goes from the host config straight to `https://coasty.ai/v1/*` over TLS.
- **API key redacted in debug logs.** A test asserts `[redacted]` appears wherever the key would otherwise. Verified in CI.
- **Sandboxed cloud VMs.** AWS EC2 ARM64 (t4g) or Azure ACI; auto-generated ED25519 keys; NoReboot AMI snapshots.
- **Local mode runs in Electron.** Screen Recording + Accessibility permissions scoped per-app on macOS; UAC-respected on Windows; xdotool sandboxing on Linux.
- **Credentials encrypted AES-GCM.** User keys never sent to the model — the LLM emits `lookup_credential("gmail.com")` and the dispatcher fills the field server-side.
- **Webhook triggers HMAC-SHA256 signed.** Stripe-style `Coasty-Signature: t=<ts>,v1=<sig>` header with 5-minute replay window. Tested against signing snippets in 8 languages.
- **Idempotency-Key on every POST tool.** 24-hour replay safety; same key + same body → cached response, never a duplicate side-effect.
- **Schemas pass strict portability checks** (no external `$ref`, no top-level `oneOf`/`anyOf`, all regex compiles, snake_case names) — enforced in CI.

---

## Quality signals

| Metric | Value |
|---|---|
| Tests | **178 / 178 passing** |
| Test files | **11** (config / client / server / annotations / errors / routing / validation / prompts / edge-cases / schema-validity / inspector-smoke) |
| TypeScript errors | **0** under `strict: true` |
| Runtime dependencies | **2** (`@modelcontextprotocol/sdk`, `zod`) — no transitive bloat |
| Package size | **33.8 kB** (126.5 kB unpacked, 54 files) |
| Tool annotation coverage | **100%** — every tool advertises read/destructive/idempotent/open-world |
| Webhook signing tests | **8 languages** (Python, JS, cURL, Go, Ruby, PHP, Java, C#) — every snippet roundtrip-verified against the live verifier |
| MCP Inspector smoke | binary spawned, JSON-RPC handshake exercised in CI on every commit |
| Cross-platform smoke | Mac + Linux + Windows (`scripts/smoke.mjs`) |
| MCP spec target | `2025-11-25` with `2025-06-18` fallback |

Reproduce locally:

```bash
git clone https://github.com/coasty-ai/coasty-mcp
cd coasty-mcp/mcp
npm install
npm run check       # lint + build + 178 tests + binary smoke. ~6s.
```

`prepublishOnly` runs `check`, so `npm publish` refuses to ship a regression.

---

## Frequently Asked Questions

### What's the cheapest way to try Coasty MCP?

Get a free `sk-coasty-test-*` sandbox key at <https://coasty.ai/developers>. It returns mock VMs in under 50 ms with zero billing. Real wire format, real action vocabulary — write your agent against it, then swap in a live key (`sk-coasty-live-*`) to ship.

### Can I run Coasty entirely on my own machine?

Yes. The Coasty Electron app registers your local machine as a "VM" with the Coasty backend. Once installed, `coasty_provision_machine` can target your local Electron — your screenshots, files, and terminal output never leave your network. The MCP server still routes through the Coasty backend for billing + scheduling, but action dispatch is local.

### Which operating systems does Coasty support inside the cloud VMs?

- **Linux**: Ubuntu 22.04 with XFCE desktop + Chromium/Chrome (default; ARM64 t4g for low cost)
- **Windows**: t3.small with full GUI (when desktop apps are required)
- **macOS**: not available in cloud VMs (Apple licensing); the Electron local-execution path covers macOS

### Which MCP hosts are officially supported?

Claude Desktop, Claude Code, Cursor, Windsurf, VS Code Copilot (Agent mode). Any MCP-spec-compliant host (`2025-06-18` or later) will work — install snippets above are tested verbatim.

### How is Coasty MCP different from Anthropic's built-in Computer Use?

Anthropic Computer Use is a **tool baked into Claude Sonnet 4.5+** that the model can call directly. It runs cloud-only, has no scheduling, no webhooks, and no local-execution path. **Coasty MCP is an external server** that any MCP host can use — works with all Claude versions, plus other providers' models that speak MCP. Coasty also adds scheduling, HMAC webhook triggers, local execution via Electron, and a 4-mode approval system. The two compose: Anthropic's tool can run **inside** a Coasty VM if you want.

### How is Coasty different from Browserbase?

Browserbase is browser-only. Coasty covers desktop applications, terminal, file system, scheduled cron jobs, and webhook-triggered automations on top of the browser surface. If you only need a headless browser, Browserbase is leaner; if you need a full computer, Coasty is the only MCP option.

### How is Coasty different from E2B?

E2B is a code-execution sandbox — great for running Python or Node, no GUI. Coasty has a full desktop, mouse, keyboard, browser, terminal, and persistent file system. E2B is faster to spin up; Coasty is the right answer when the agent needs to interact with a real GUI.

### How safe is it to give Coasty MCP access to my machine?

Three layers of defense:
1. **Per-action approval** — choose `smart_approve` (default), `approve_all`, or `off` modes. Destructive tools (`destructiveHint: true`) prompt before executing.
2. **Scopes on every API key** — mint a key with only `machines:read` if you want a read-only audit, only `predict` if you want pure inference, etc.
3. **Sandbox first** — develop with `sk-coasty-test-*` keys; the agent can't accidentally provision a $50/hr Windows VM.

The API key is never sent to the model — it stays in your MCP host's environment. The local Electron app respects macOS Screen Recording + Accessibility permissions, Windows UAC, and Linux's xdotool sandboxing.

### Where is the source code?

- **npm**: <https://www.npmjs.com/package/@coasty/mcp>
- **GitHub**: <https://github.com/coasty-ai/coasty-mcp>
- **Coasty platform docs**: <https://coasty.ai/api-docs>
- **MIT license**

### How do I report a bug or request a feature?

GitHub issues, or email <founders@coasty.ai>. Security disclosures: see [SECURITY.md](https://github.com/coasty-ai/coasty-mcp/blob/main/SECURITY.md).

---

## Privacy Policy

The Coasty MCP server is a thin client that forwards your requests to the Coasty REST API. It does not log payloads, screenshots, file contents, or terminal output beyond what's needed to surface errors. Debug mode (`COASTY_MCP_DEBUG=1`) prints request paths and status codes to stderr; the API key is always redacted.

The Coasty platform's full privacy policy — covering data collection, retention, third-party sharing, and contact — lives at <https://coasty.ai/privacy>. Highlights:

- **API requests** are processed via Coasty's backend on AWS (us-east-1 by default; EU regions available on enterprise plans).
- **Screenshots and command outputs** are stored only as long as needed to fulfill the request and surface results in your dashboard.
- **No training on your data.** Coasty does not use customer payloads to train any model.
- **Local mode** runs entirely on your machine; the only network traffic is the per-action authorization handshake with the Coasty backend.
- **Sub-processors**: Anthropic / Bedrock (LLM inference), AWS (EC2, S3), Azure (ACI), Stripe (billing), Supabase (auth + DB), PostHog (analytics).
- **GDPR / CCPA** compliant; DPA available on request.

Contact: <privacy@coasty.ai>

---

## Develop locally

```bash
cd mcp
npm install                # first time only
npm run build:watch        # tsc in watch mode
npm run test:watch         # vitest in watch mode
npm run inspector          # Anthropic MCP Inspector UI on localhost:6274
```

| Script | What it does |
|---|---|
| `npm run check` | Lint + build + 178 tests + cross-platform smoke. **Pre-publish gate.** |
| `npm test` | Vitest, one-shot |
| `npm run test:coverage` | V8 coverage report → `coverage/` |
| `npm run smoke` | Cross-platform binary smoke check (Win/Mac/Linux) |
| `npm run inspector:tools` | Dump every tool's schema as JSON |
| `npm run inspector:prompts` | Dump both prompts as JSON |

---

## Roadmap (transparent)

- **Streamable HTTP transport** to a hosted endpoint at `mcp.coasty.ai/mcp` — same code, OAuth 2.1 + PKCE auth, no `npx` install needed.
- **OSWorld-MCP benchmark publication** — running the canonical MCP-tool-invocation benchmark and publishing the score (this README will be updated; numbers will only ever come from a real run).
- **`.mcpb` bundle** for one-click Claude Desktop install (manifest is shipped in this repo; awaiting Anthropic directory submission review).
- **Marketplace listing** on Smithery, PulseMCP, MCP.so (auto-indexed from the official registry).

---

## License

MIT © 2026 Coasty
