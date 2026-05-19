"use client"

import { notFound } from "next/navigation"
import { SectionDivider } from "@/app/components/landing/guide-lines"
import { LandingHeader } from "@/app/components/landing/landing-header"
import { LandingFooter } from "@/app/components/landing/landing-footer"
import { APITab } from "@/app/guide/tabs/api"
import { DEVELOPERS_API_ENABLED } from "@/lib/feature-flags"
import { motion, AnimatePresence, useMotionValue, useSpring } from "framer-motion"
import Link from "next/link"
import { useEffect, useState, type MouseEvent } from "react"
import {
  ArrowRight,
  MousePointerClick,
  Monitor,
  Terminal,
  Zap,
  Code2,
  Layers,
  Eye,
  Check,
  Copy,
  Command,
  Globe,
  Cpu,
  Sparkles,
  ChevronRight,
  type LucideIcon,
} from "lucide-react"

const ease = [0.22, 1, 0.36, 1] as const

/* ═══════════════════════════════════════════════════════════════
   HERO VISUAL — cinematic request/response device
   ═══════════════════════════════════════════════════════════════ */

type Scene = {
  kind: "click" | "type" | "press"
  target: { x: number; y: number; w: number; h: number }
  code: string
  resp: { action_type: string; params: Record<string, string | number> }
}

const SCENES: Scene[] = [
  {
    kind: "click",
    target: { x: 24, y: 120, w: 148, h: 32 },
    code: 'click(x=98, y=136)',
    resp: { action_type: "click", params: { x: 98, y: 136 } },
  },
  {
    kind: "type",
    target: { x: 24, y: 64, w: 280, h: 32 },
    code: 'type("open-source alternatives")',
    resp: { action_type: "type_text", params: { text: "open-source…" } },
  },
  {
    kind: "press",
    target: { x: 188, y: 120, w: 116, h: 32 },
    code: 'click(x=246, y=136)',
    resp: { action_type: "click", params: { x: 246, y: 136 } },
  },
]

function HeroVisual() {
  const [i, setI] = useState(0)
  const scene = SCENES[i]

  useEffect(() => {
    const id = setInterval(() => setI((p) => (p + 1) % SCENES.length), 3400)
    return () => clearInterval(id)
  }, [])

  // subtle parallax tilt on pointer
  const rx = useMotionValue(0)
  const ry = useMotionValue(0)
  const srx = useSpring(rx, { stiffness: 120, damping: 18 })
  const sry = useSpring(ry, { stiffness: 120, damping: 18 })
  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const dx = (e.clientX - r.left) / r.width - 0.5
    const dy = (e.clientY - r.top) / r.height - 0.5
    rx.set(dy * -4)
    ry.set(dx * 4)
  }
  const onLeave = () => {
    rx.set(0)
    ry.set(0)
  }

  return (
    <div
      className="relative w-full max-w-md mx-auto"
      style={{ perspective: 1200 }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      {/* faint orbit glow */}
      <div className="absolute -inset-12 -z-10 opacity-40 dark:opacity-60 pointer-events-none">
        <div className="absolute inset-0 rounded-[40px] bg-[radial-gradient(circle_at_30%_20%,_rgba(59,130,246,0.18),transparent_60%),radial-gradient(circle_at_70%_80%,_rgba(16,185,129,0.12),transparent_55%)] blur-2xl" />
      </div>

      <motion.div
        style={{ rotateX: srx, rotateY: sry, transformStyle: "preserve-3d" }}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.1, ease }}
        className="relative rounded-2xl border border-border/40 bg-card/80 backdrop-blur-xl overflow-hidden shadow-[0_30px_80px_-30px_rgba(0,0,0,0.25)] dark:shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]"
      >
        {/* hairline top highlight */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/20 to-transparent" />

        {/* Chrome */}
        <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border/30 bg-gradient-to-b from-muted/30 to-transparent">
          <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />
          <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />
          <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />
          <div className="ml-3 flex items-center gap-1.5 h-5 rounded-md bg-muted/30 px-2.5 text-[9px] font-mono text-muted-foreground/50">
            <Globe className="h-2.5 w-2.5" />
            <span>coasty.ai/demo</span>
          </div>
          <div className="ml-auto flex items-center gap-1 text-[9px] font-mono text-muted-foreground/40">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>live</span>
          </div>
        </div>

        {/* Canvas — target UI */}
        <div className="relative h-[240px] overflow-hidden">
          {/* subtle grid backdrop */}
          <div
            className="absolute inset-0 opacity-[0.04] dark:opacity-[0.06]"
            style={{
              backgroundImage:
                "linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)",
              backgroundSize: "16px 16px",
            }}
          />

          {/* Mock UI */}
          <div className="relative p-6 space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-5 w-5 rounded-md bg-foreground/[0.08]" />
              <div className="h-2 w-16 rounded-full bg-foreground/[0.08]" />
              <div className="ml-auto h-2 w-10 rounded-full bg-foreground/[0.05]" />
            </div>

            {/* search bar */}
            <div className="relative h-8 rounded-lg border border-border/40 bg-background/60 px-3 flex items-center">
              <div className="h-2 w-2.5 rounded-full bg-foreground/20" />
              <div className="ml-2 h-2 w-32 rounded-full bg-foreground/[0.06]" />
            </div>

            {/* buttons row */}
            <div className="flex gap-2">
              <div className="relative h-8 flex-1 rounded-lg bg-foreground/[0.04] flex items-center justify-center">
                <div className="h-2 w-10 rounded-full bg-foreground/[0.12]" />
              </div>
              <div className="relative h-8 w-[116px] rounded-lg bg-foreground text-background flex items-center justify-center">
                <div className="h-2 w-10 rounded-full bg-background/60" />
              </div>
            </div>

            {/* result cards */}
            <div className="pt-1 space-y-1.5">
              {[0, 1].map((k) => (
                <div key={k} className="h-6 rounded-md border border-border/20 bg-background/40 px-2 flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-foreground/15" />
                  <div className="h-1.5 w-20 rounded-full bg-foreground/[0.06]" />
                  <div className="ml-auto h-1.5 w-8 rounded-full bg-foreground/[0.04]" />
                </div>
              ))}
            </div>
          </div>

          {/* Moving bounding box */}
          <motion.div
            animate={{
              left: scene.target.x,
              top: scene.target.y,
              width: scene.target.w,
              height: scene.target.h,
            }}
            transition={{ type: "spring", stiffness: 180, damping: 22 }}
            className="absolute rounded-md border border-blue-500/90 pointer-events-none"
            style={{ boxShadow: "0 0 0 3px rgba(59,130,246,0.12)" }}
          >
            {/* corner ticks */}
            {[
              "top-0 left-0 border-t border-l -translate-x-[1px] -translate-y-[1px]",
              "top-0 right-0 border-t border-r translate-x-[1px] -translate-y-[1px]",
              "bottom-0 left-0 border-b border-l -translate-x-[1px] translate-y-[1px]",
              "bottom-0 right-0 border-b border-r translate-x-[1px] translate-y-[1px]",
            ].map((cls, idx) => (
              <span key={idx} className={`absolute h-1.5 w-1.5 border-blue-500 ${cls}`} />
            ))}
            {/* label */}
            <div className="absolute -top-5 left-0 text-[9px] font-mono font-medium text-blue-500 bg-background/90 border border-blue-500/20 rounded px-1 py-[1px]">
              {scene.kind}
            </div>
          </motion.div>

          {/* Cursor */}
          <motion.div
            animate={{
              left: scene.target.x + scene.target.w / 2,
              top: scene.target.y + scene.target.h / 2,
            }}
            transition={{ type: "spring", stiffness: 120, damping: 18 }}
            className="absolute pointer-events-none"
          >
            <motion.div
              animate={{ scale: [1, 0.88, 1] }}
              transition={{ duration: 0.5, delay: 0.4, ease }}
            >
              <MousePointerClick className="h-4 w-4 text-foreground drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]" />
            </motion.div>
            {/* click ripple */}
            <motion.div
              key={i}
              initial={{ scale: 0, opacity: 0.6 }}
              animate={{ scale: 2.5, opacity: 0 }}
              transition={{ duration: 0.7, delay: 0.45, ease }}
              className="absolute -inset-2 rounded-full border border-blue-500/50"
            />
          </motion.div>
        </div>
      </motion.div>

      {/* Floating JSON response card */}
      <motion.div
        initial={{ opacity: 0, x: 28, y: 12 }}
        animate={{ opacity: 1, x: 0, y: 0 }}
        transition={{ duration: 0.6, delay: 0.9, ease }}
        className="absolute -right-4 -bottom-8 rounded-xl border border-border/40 bg-card/95 backdrop-blur-xl p-3 shadow-[0_12px_30px_-12px_rgba(0,0,0,0.25)] dark:shadow-[0_12px_30px_-12px_rgba(0,0,0,0.7)] w-[220px]"
      >
        <div className="flex items-center gap-1.5 pb-2 mb-2 border-b border-border/20">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          <span className="text-[9px] font-mono font-semibold text-muted-foreground/50 uppercase tracking-wider">
            200 OK
          </span>
          <span className="ml-auto text-[9px] font-mono text-muted-foreground/35">1.2s</span>
        </div>
        <AnimatePresence mode="wait">
          <motion.pre
            key={i}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25, ease }}
            className="text-[10px] font-mono leading-[1.5]"
          >
            <span className="text-muted-foreground/40">{"{"}</span>
            {"\n  "}
            <span className="text-blue-500">&quot;action_type&quot;</span>
            <span className="text-muted-foreground/40">: </span>
            <span className="text-emerald-600 dark:text-emerald-400">&quot;{scene.resp.action_type}&quot;</span>
            <span className="text-muted-foreground/40">,</span>
            {"\n  "}
            <span className="text-blue-500">&quot;params&quot;</span>
            <span className="text-muted-foreground/40">: {"{"}</span>
            {Object.entries(scene.resp.params).map(([k, v]) => (
              <span key={k}>
                {"\n    "}
                <span className="text-blue-500">&quot;{k}&quot;</span>
                <span className="text-muted-foreground/40">: </span>
                <span className="text-amber-600 dark:text-amber-400">
                  {typeof v === "string" ? `"${v}"` : v}
                </span>
                <span className="text-muted-foreground/40">,</span>
              </span>
            ))}
            {"\n  "}
            <span className="text-muted-foreground/40">{"}"}</span>
            {"\n"}
            <span className="text-muted-foreground/40">{"}"}</span>
          </motion.pre>
        </AnimatePresence>
      </motion.div>

      {/* Sidecar chip — inference time */}
      <motion.div
        initial={{ opacity: 0, x: -16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5, delay: 1.1, ease }}
        className="absolute -left-3 top-20 rounded-lg border border-border/40 bg-card/90 backdrop-blur-md px-2.5 py-1.5 flex items-center gap-1.5"
      >
        <Cpu className="h-3 w-3 text-foreground/45" />
        <span className="text-[10px] font-mono font-medium text-foreground/55">3.5s / step</span>
      </motion.div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   LANGUAGE SWITCHER (Try it section)
   ═══════════════════════════════════════════════════════════════ */

const LANGS = [
  { id: "python", label: "Python" },
  { id: "javascript", label: "Node" },
  { id: "curl", label: "cURL" },
  { id: "go", label: "Go" },
] as const
type LangId = (typeof LANGS)[number]["id"]

// Each Predict snippet is one shape across languages; bodies validate against
// backend/app/models/public_cua.py (predict request schema) — verified by
// backend/tests/test_doc_examples.py + test_public_cua_routes.py.
const SNIPPETS: Record<LangId, string> = {
  python: `import requests, base64

img = base64.b64encode(open("screen.png", "rb").read()).decode()

r = requests.post(
    "https://coasty.ai/v1/predict",
    headers={"X-API-Key": "sk-coasty-live-..."},
    json={
        "screenshot": img,
        "instruction": "Click the search bar and type 'hello'",
    },
)

for a in r.json()["actions"]:
    print(a["action_type"], a["params"])`,
  javascript: `const img = fs.readFileSync("screen.png").toString("base64")

const res = await fetch("https://coasty.ai/v1/predict", {
  method: "POST",
  headers: {
    "X-API-Key": "sk-coasty-live-...",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    screenshot: img,
    instruction: "Click the search bar and type 'hello'",
  }),
})

const { actions } = await res.json()
actions.forEach(a => console.log(a.action_type, a.params))`,
  curl: `curl https://coasty.ai/v1/predict \\
  -H "X-API-Key: sk-coasty-live-..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "screenshot": "<base64_encoded_png>",
    "instruction": "Click the search bar and type \\"hello\\""
  }'`,
  go: `body, _ := json.Marshal(map[string]any{
    "screenshot":  img,
    "instruction": "Click the search bar and type 'hello'",
})

req, _ := http.NewRequest("POST",
    "https://coasty.ai/v1/predict",
    bytes.NewReader(body))
req.Header.Set("X-API-Key", "sk-coasty-live-...")
req.Header.Set("Content-Type", "application/json")

resp, _ := http.DefaultClient.Do(req)
defer resp.Body.Close()`,
}

// Schedules API snippets — create + add a webhook trigger + sign a webhook
// fire from the customer side. The webhook signing math is roundtrip-tested
// in backend/tests/test_public_schedules.py::TestEndToEndWebhookSigning, so
// the snippet below produces a Coasty-Signature the verifier accepts.
const SCHEDULES_SNIPPETS: Record<LangId, string> = {
  python: `import requests, hmac, hashlib, time

# 1. Create a daily 9 AM ET schedule
sched = requests.post(
    "https://coasty.ai/v1/schedules",
    headers={"X-API-Key": "sk-coasty-test-..."},
    json={
        "name": "morning briefing",
        "machine_id": "550e8400-e29b-41d4-a716-446655440000",
        "task_prompt": "Summarize unread Gmail and post to Slack.",
        "frequency": "daily",
        "time": "09:00",
        "timezone": "America/New_York",
    },
).json()

# 2. Add a webhook trigger — store the secret immediately
trigger = requests.post(
    f"https://coasty.ai/v1/schedules/{sched['id']}/triggers",
    headers={"X-API-Key": "sk-coasty-test-..."},
    json={"kind": "webhook"},
).json()
secret = trigger["webhook_secret"]   # whsec_<64 hex>  — store this

# 3. Sign + fire the webhook from any external system
ts = int(time.time())
body = b'{"event":"order.placed"}'
sig = hmac.new(secret.encode(), f"{ts}.".encode() + body,
               hashlib.sha256).hexdigest()
requests.post(
    trigger["webhook_url"],
    headers={"Coasty-Signature": f"t={ts},v1={sig}"},
    data=body,
)`,
  javascript: `// Node 18+ — global fetch + node:crypto
import { createHmac } from "node:crypto"

// 1. Create a schedule
const sched = await (await fetch("https://coasty.ai/v1/schedules", {
  method: "POST",
  headers: { "X-API-Key": "sk-coasty-test-...", "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "morning briefing",
    machine_id: "550e8400-e29b-41d4-a716-446655440000",
    task_prompt: "Summarize unread Gmail and post to Slack.",
    frequency: "daily",
    time: "09:00",
    timezone: "America/New_York",
  }),
})).json()

// 2. Add a webhook trigger
const trigger = await (await fetch(
  \`https://coasty.ai/v1/schedules/\${sched.id}/triggers\`,
  {
    method: "POST",
    headers: { "X-API-Key": "sk-coasty-test-...", "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "webhook" }),
  },
)).json()
const secret = trigger.webhook_secret

// 3. Sign + fire
const ts = Math.floor(Date.now() / 1000)
const body = Buffer.from('{"event":"order.placed"}')
const payload = Buffer.concat([Buffer.from(\`\${ts}.\`), body])
const sig = createHmac("sha256", secret).update(payload).digest("hex")
await fetch(trigger.webhook_url, {
  method: "POST",
  headers: { "Coasty-Signature": \`t=\${ts},v1=\${sig}\`, "Content-Type": "application/json" },
  body,
})`,
  curl: `# 1. Create a schedule
SCHED=$(curl -s -X POST https://coasty.ai/v1/schedules \\
  -H "X-API-Key: sk-coasty-test-..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "morning briefing",
    "machine_id": "550e8400-e29b-41d4-a716-446655440000",
    "task_prompt": "Summarize unread Gmail and post to Slack.",
    "frequency": "daily",
    "time": "09:00",
    "timezone": "America/New_York"
  }' | jq -r .id)

# 2. Add a webhook trigger
TRIG=$(curl -s -X POST https://coasty.ai/v1/schedules/$SCHED/triggers \\
  -H "X-API-Key: sk-coasty-test-..." \\
  -H "Content-Type: application/json" \\
  -d '{"kind":"webhook"}')
SECRET=$(echo $TRIG | jq -r .webhook_secret)
URL=$(echo $TRIG | jq -r .webhook_url)

# 3. Sign + fire
TS=$(date +%s)
BODY='{"event":"order.placed"}'
SIG=$(printf '%s.%s' "$TS" "$BODY" | \\
      openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')
curl -X POST "$URL" \\
  -H "Coasty-Signature: t=$TS,v1=$SIG" \\
  -H "Content-Type: application/json" \\
  --data "$BODY"`,
  go: `// import: net/http, encoding/json, crypto/hmac, crypto/sha256,
// encoding/hex, fmt, time, bytes
body, _ := json.Marshal(map[string]any{
  "name":        "morning briefing",
  "machine_id":  "550e8400-e29b-41d4-a716-446655440000",
  "task_prompt": "Summarize unread Gmail and post to Slack.",
  "frequency":   "daily",
  "time":        "09:00",
  "timezone":    "America/New_York",
})

req, _ := http.NewRequest("POST",
  "https://coasty.ai/v1/schedules",
  bytes.NewReader(body))
req.Header.Set("X-API-Key", "sk-coasty-test-...")
req.Header.Set("Content-Type", "application/json")

// Add a webhook trigger and sign as customer:
// secret := triggerResponse["webhook_secret"]
// ts := time.Now().Unix()
// payload := append([]byte(fmt.Sprintf("%d.", ts)), body...)
// h := hmac.New(sha256.New, []byte(secret))
// h.Write(payload)
// sig := hex.EncodeToString(h.Sum(nil))
// "Coasty-Signature: t=<ts>,v1=<sig>"`,
}

// Machines API snippets — provision a sandbox VM in one call. All bodies
// validate against backend/app/models/public_machines.py (extra="forbid").
// Verified by backend/tests/test_doc_examples.py.
const MACHINES_SNIPPETS: Record<LangId, string> = {
  python: `import requests

# Provision a sandbox VM (sk-coasty-test-* — instant, no AWS, no billing).
r = requests.post(
    "https://coasty.ai/v1/machines",
    headers={
        "X-API-Key": "sk-coasty-test-...",
        "Idempotency-Key": "demo-001",
    },
    json={
        "display_name": "automation-bot",
        "os_type": "linux",
        "desktop_enabled": True,
    },
)
machine = r.json()["machine"]

# Drive it: click at (512, 340)
requests.post(
    f"https://coasty.ai/v1/machines/{machine['id']}/actions",
    headers={"X-API-Key": "sk-coasty-test-..."},
    json={"command": "click", "parameters": {"x": 512, "y": 340}},
)`,
  javascript: `// Node 18+ — global fetch
const provision = await fetch("https://coasty.ai/v1/machines", {
  method: "POST",
  headers: {
    "X-API-Key": "sk-coasty-test-...",
    "Content-Type": "application/json",
    "Idempotency-Key": "demo-001",
  },
  body: JSON.stringify({
    display_name: "automation-bot",
    os_type: "linux",
    desktop_enabled: true,
  }),
})
const { machine } = await provision.json()

// Drive it
await fetch(\`https://coasty.ai/v1/machines/\${machine.id}/actions\`, {
  method: "POST",
  headers: { "X-API-Key": "sk-coasty-test-...", "Content-Type": "application/json" },
  body: JSON.stringify({ command: "click", parameters: { x: 512, y: 340 } }),
})`,
  curl: `# 1. Provision
curl -X POST https://coasty.ai/v1/machines \\
  -H "X-API-Key: sk-coasty-test-..." \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: demo-001" \\
  -d '{
    "display_name": "automation-bot",
    "os_type": "linux",
    "desktop_enabled": true
  }'

# 2. Drive it (paste the id from step 1)
curl -X POST https://coasty.ai/v1/machines/$ID/actions \\
  -H "X-API-Key: sk-coasty-test-..." \\
  -H "Content-Type: application/json" \\
  -d '{"command":"click","parameters":{"x":512,"y":340}}'`,
  go: `body, _ := json.Marshal(map[string]any{
  "display_name":    "automation-bot",
  "os_type":         "linux",
  "desktop_enabled": true,
})
req, _ := http.NewRequest("POST",
  "https://coasty.ai/v1/machines",
  bytes.NewReader(body))
req.Header.Set("X-API-Key", "sk-coasty-test-...")
req.Header.Set("Content-Type", "application/json")
req.Header.Set("Idempotency-Key", "demo-001")

resp, _ := http.DefaultClient.Do(req)
defer resp.Body.Close()
// Parse resp.Body for { "machine": { "id": "..." } }, then POST to /actions.`,
}

function highlightLine(line: string, lang: LangId) {
  // cheap, safe token coloring — no runtime risk, purely regex-based
  const parts: { t: string; c?: string }[] = []
  let s = line
  const push = (t: string, c?: string) => parts.push({ t, c })

  if (lang === "curl") {
    const m = s.match(/^(\s*)(curl|-H|-d)(.*)$/)
    if (m) {
      push(m[1])
      push(m[2], "text-emerald-600 dark:text-emerald-400")
      push(m[3], "text-foreground/70")
      return parts
    }
  }
  // string literals
  const strRe = /("[^"]*"|'[^']*')/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = strRe.exec(s)) !== null) {
    if (match.index > last) push(s.slice(last, match.index), "text-foreground/75")
    push(match[0], "text-amber-600 dark:text-amber-400")
    last = match.index + match[0].length
  }
  if (last < s.length) push(s.slice(last), "text-foreground/75")
  return parts
}

function CodeBlock({ code, lang }: { code: string; lang: LangId }) {
  const [copied, setCopied] = useState(false)
  const lines = code.split("\n")

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="relative group">
      <button
        onClick={onCopy}
        aria-label="Copy code"
        className="absolute top-3 right-3 z-10 flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border/40 bg-card/90 backdrop-blur text-[10px] font-medium text-muted-foreground/70 hover:text-foreground hover:border-border/70 hover:bg-card transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
      >
        <AnimatePresence mode="wait">
          {copied ? (
            <motion.span
              key="c"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"
            >
              <Check className="h-3 w-3" /> Copied
            </motion.span>
          ) : (
            <motion.span
              key="d"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex items-center gap-1"
            >
              <Copy className="h-3 w-3" /> Copy
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      <pre className="text-[12px] font-mono leading-[1.75] px-5 py-5 pr-20 overflow-x-auto">
        {lines.map((line, li) => (
          <div key={li} className="flex gap-4">
            <span className="shrink-0 text-muted-foreground/25 select-none w-5 text-right tabular-nums">
              {li + 1}
            </span>
            <span className="flex-1 whitespace-pre">
              {line.length === 0
                ? "\u00A0"
                : highlightLine(line, lang).map((p, pi) => (
                    <span key={pi} className={p.c}>
                      {p.t}
                    </span>
                  ))}
            </span>
          </div>
        ))}
      </pre>
    </div>
  )
}

function TryIt() {
  const [lang, setLang] = useState<LangId>("python")

  return (
    <div className="mx-auto max-w-3xl">
      {/* Tabs */}
      <div className="relative inline-flex items-center rounded-xl border border-border/30 bg-card/50 backdrop-blur-sm p-1 mb-5">
        {LANGS.map((l) => {
          const active = l.id === lang
          return (
            <button
              key={l.id}
              onClick={() => setLang(l.id)}
              className={`relative px-4 py-1.5 text-[12px] font-medium rounded-lg transition-colors ${
                active ? "text-foreground" : "text-muted-foreground/55 hover:text-foreground/80"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="lang-pill"
                  transition={{ type: "spring", stiffness: 320, damping: 28 }}
                  className="absolute inset-0 rounded-lg bg-foreground/[0.06] border border-border/40"
                />
              )}
              <span className="relative">{l.label}</span>
            </button>
          )
        })}
      </div>

      {/* Code card */}
      <div className="relative rounded-2xl border border-border/30 bg-card/50 backdrop-blur-sm overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.08] to-transparent" />

        {/* File chrome */}
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-border/20">
          <div className="flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 text-muted-foreground/40" />
            <span className="text-[11px] font-mono text-muted-foreground/55">
              POST /v1/predict
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/35">
            <span className="hidden sm:flex items-center gap-1">
              <Command className="h-3 w-3" />C
            </span>
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={lang}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease }}
          >
            <CodeBlock code={SNIPPETS[lang]} lang={lang} />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Response sample strip */}
      <div className="mt-3 flex items-center gap-2 text-[11px] font-mono text-muted-foreground/45">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        <span>Returns a stream of typed actions — coordinates, keystrokes, and confidence.</span>
        <a
          href="#docs"
          className="ml-auto hidden sm:inline-flex items-center gap-1 text-foreground/60 hover:text-foreground transition-colors"
        >
          Full reference <ChevronRight className="h-3 w-3" />
        </a>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   MACHINES — provision + drive a real VM in one snippet.
   Mirrors TryIt's tab pattern. Bodies are validated by
   backend/tests/test_doc_examples.py against the live Pydantic
   models, so what you copy here is what will actually parse.
   ═══════════════════════════════════════════════════════════════ */

function MachinesTryIt() {
  const [lang, setLang] = useState<LangId>("python")

  return (
    <div className="mx-auto max-w-3xl">
      {/* Tabs */}
      <div className="relative inline-flex items-center rounded-xl border border-border/30 bg-card/50 backdrop-blur-sm p-1 mb-5">
        {LANGS.map((l) => {
          const active = l.id === lang
          return (
            <button
              key={l.id}
              onClick={() => setLang(l.id)}
              className={`relative px-4 py-1.5 text-[12px] font-medium rounded-lg transition-colors ${
                active ? "text-foreground" : "text-muted-foreground/55 hover:text-foreground/80"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="machines-lang-pill"
                  transition={{ type: "spring", stiffness: 320, damping: 28 }}
                  className="absolute inset-0 rounded-lg bg-foreground/[0.06] border border-border/40"
                />
              )}
              <span className="relative">{l.label}</span>
            </button>
          )
        })}
      </div>

      <div className="relative rounded-2xl border border-border/30 bg-card/50 backdrop-blur-sm overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.08] to-transparent" />

        {/* File chrome */}
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-border/20">
          <div className="flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 text-muted-foreground/40" />
            <span className="text-[11px] font-mono text-muted-foreground/55">
              POST /v1/machines  +  POST /v1/machines/{"{id}"}/actions
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/35">
            <span className="hidden sm:flex items-center gap-1">
              sandbox · no billing
            </span>
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={lang}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease }}
          >
            <CodeBlock code={MACHINES_SNIPPETS[lang]} lang={lang} />
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-3 flex items-center gap-2 text-[11px] font-mono text-muted-foreground/45">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        <span>Sandbox keys (sk-coasty-test-*) return a mock VM in &lt; 50 ms — instant retries, zero AWS cost.</span>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   SCHEDULES — create + add webhook trigger + sign a fire end-to-end.
   The webhook signing math here is roundtrip-tested against the
   actual verifier in backend/tests/test_public_schedules.py, so the
   snippets you copy from this page WILL produce a valid Coasty-Signature.
   ═══════════════════════════════════════════════════════════════ */

function SchedulesTryIt() {
  const [lang, setLang] = useState<LangId>("python")

  return (
    <div className="mx-auto max-w-3xl">
      <div className="relative inline-flex items-center rounded-xl border border-border/30 bg-card/50 backdrop-blur-sm p-1 mb-5">
        {LANGS.map((l) => {
          const active = l.id === lang
          return (
            <button
              key={l.id}
              onClick={() => setLang(l.id)}
              className={`relative px-4 py-1.5 text-[12px] font-medium rounded-lg transition-colors ${
                active ? "text-foreground" : "text-muted-foreground/55 hover:text-foreground/80"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="schedules-lang-pill"
                  transition={{ type: "spring", stiffness: 320, damping: 28 }}
                  className="absolute inset-0 rounded-lg bg-foreground/[0.06] border border-border/40"
                />
              )}
              <span className="relative">{l.label}</span>
            </button>
          )
        })}
      </div>

      <div className="relative rounded-2xl border border-border/30 bg-card/50 backdrop-blur-sm overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.08] to-transparent" />

        <div className="flex items-center justify-between px-5 py-2.5 border-b border-border/20">
          <div className="flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 text-muted-foreground/40" />
            <span className="text-[11px] font-mono text-muted-foreground/55">
              POST /v1/schedules &nbsp;+&nbsp; POST /triggers (webhook) &nbsp;+&nbsp; sign &amp; fire
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/35">
            <span className="hidden sm:flex items-center gap-1">HMAC-SHA256 · 5-min replay window</span>
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={lang}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease }}
          >
            <CodeBlock code={SCHEDULES_SNIPPETS[lang]} lang={lang} />
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-3 flex items-center gap-2 text-[11px] font-mono text-muted-foreground/45">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        <span>Schedules created via API show up in your /schedules dashboard automatically — same user_id, same view.</span>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   FEATURE CARD — border-light hover, signature icon watermark
   ═══════════════════════════════════════════════════════════════ */

function FeatureCard({
  icon: Icon,
  title,
  description,
  delay,
}: {
  icon: LucideIcon
  title: string
  description: string
  delay: number
}) {
  const [mp, setMp] = useState({ x: -999, y: -999 })

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.5, delay, ease }}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        setMp({ x: e.clientX - r.left, y: e.clientY - r.top })
      }}
      onMouseLeave={() => setMp({ x: -999, y: -999 })}
      className="relative rounded-2xl border border-border/30 bg-card/40 backdrop-blur-sm p-6 overflow-hidden group transition-colors hover:border-border/60"
    >
      {/* spotlight */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{
          background: `radial-gradient(240px circle at ${mp.x}px ${mp.y}px, rgba(255,255,255,0.06), transparent 65%)`,
        }}
      />
      {/* top hairline */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent" />
      {/* watermark */}
      <Icon
        className="h-24 w-24 absolute -bottom-4 -right-4 text-foreground/[0.03] group-hover:text-foreground/[0.05] transition-colors pointer-events-none"
        strokeWidth={1}
      />

      <div className="relative">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-foreground/[0.05] border border-border/20 mb-4 group-hover:border-border/40 transition-colors">
          <Icon className="h-4 w-4 text-foreground/60" strokeWidth={1.8} />
        </div>
        <h3 className="text-sm font-semibold mb-1.5">{title}</h3>
        <p className="text-[13px] text-muted-foreground/55 leading-relaxed">{description}</p>
      </div>
    </motion.div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   PRICING ROW — inline hover bar, tight typography
   ═══════════════════════════════════════════════════════════════ */

function PricingRow({
  endpoint,
  cost,
  description,
  highlight,
}: {
  endpoint: string
  cost: string
  description: string
  highlight?: boolean
}) {
  return (
    <div className="group relative flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-foreground/[0.015]">
      <span className="absolute inset-y-0 left-0 w-[2px] bg-foreground/30 scale-y-0 group-hover:scale-y-100 transition-transform origin-center" />
      <code className="text-[11.5px] font-mono text-foreground/70 flex-1 truncate">{endpoint}</code>
      <span className="text-[11px] text-muted-foreground/45 hidden sm:block w-44 truncate">
        {description}
      </span>
      <span
        className={`text-[11px] font-mono font-semibold w-16 text-right shrink-0 ${
          highlight ? "text-emerald-600 dark:text-emerald-400" : "text-foreground/60"
        }`}
      >
        {cost}
      </span>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   MAGNETIC PRIMARY CTA
   ═══════════════════════════════════════════════════════════════ */

function PrimaryCTA({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const sx = useSpring(x, { stiffness: 200, damping: 18 })
  const sy = useSpring(y, { stiffness: 200, damping: 18 })

  return (
    <motion.div style={{ x: sx, y: sy }} className="inline-block">
      <Link
        href={href}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          x.set(((e.clientX - r.left) / r.width - 0.5) * 8)
          y.set(((e.clientY - r.top) / r.height - 0.5) * 8)
        }}
        onMouseLeave={() => {
          x.set(0)
          y.set(0)
        }}
        className="relative inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition-colors bg-foreground text-background overflow-hidden group"
      >
        {/* shine sweep */}
        <span className="pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-[1100ms] ease-out bg-gradient-to-r from-transparent via-background/20 to-transparent" />
        <span className="relative flex items-center gap-2">
          {children}
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
    </motion.div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════ */

export default function ApiDocsPage() {
  if (!DEVELOPERS_API_ENABLED) notFound()

  return (
    <div className="min-h-screen bg-background text-foreground relative">
      <LandingHeader />

      {/* ─── HERO ─── */}
      <section className="pt-32 sm:pt-40 pb-24 px-7 sm:px-10 relative overflow-hidden">
        {/* top gradient wash */}
        <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-[520px] w-[1100px] bg-[radial-gradient(closest-side,_rgba(59,130,246,0.10),transparent)] blur-2xl" />

        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-14 lg:gap-20 items-center">
            {/* Left — copy */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease }}
            >
              {/* eyebrow */}
              <div className="inline-flex items-center gap-2 h-7 pl-1 pr-3 rounded-full border border-border/40 bg-card/40 backdrop-blur-sm mb-6">
                <span className="relative flex h-5 w-5 items-center justify-center rounded-full bg-foreground/[0.06]">
                  <Terminal className="h-3 w-3 text-foreground/60" />
                </span>
                <span className="text-[10.5px] font-semibold text-muted-foreground/60 uppercase tracking-[0.14em]">
                  Computer Use API
                </span>
                <span className="h-3 w-px bg-border/50" />
                <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <span className="h-1 w-1 rounded-full bg-emerald-500 animate-pulse" />
                  v1
                </span>
              </div>

              <h1 className="text-[38px] sm:text-5xl lg:text-[56px] font-bold tracking-[-0.025em] leading-[1.02] mb-6">
                Give your code
                <br />
                <span className="relative inline-block">
                  <span className="bg-gradient-to-r from-foreground via-foreground/60 to-foreground/40 bg-clip-text text-transparent">
                    eyes and hands.
                  </span>
                  <motion.span
                    aria-hidden
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.8, delay: 0.5, ease }}
                    className="absolute -bottom-1 left-0 right-0 h-px bg-gradient-to-r from-foreground/40 to-transparent origin-left"
                  />
                </span>
              </h1>

              <p className="text-[15px] sm:text-[17px] text-muted-foreground/65 leading-[1.55] max-w-md mb-8">
                Send a screenshot. Get structured mouse and keyboard actions back. One REST endpoint — for automation, browser testing, and AI agents that interact with any GUI.
              </p>

              <div className="flex flex-wrap items-center gap-3 mb-10">
                <PrimaryCTA href="/auth">Get Started Free</PrimaryCTA>
                <a
                  href="#docs"
                  className="inline-flex items-center gap-2 rounded-xl border border-border/40 px-6 py-3 text-sm font-medium text-muted-foreground/75 hover:text-foreground hover:border-border/70 transition-all group"
                >
                  <Code2 className="h-4 w-4" />
                  Read the Docs
                  <ChevronRight className="h-3.5 w-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                </a>
              </div>

              {/* Metric strip */}
              <div className="grid grid-cols-3 gap-6 max-w-md">
                {[
                  { v: "3.5s", l: "median step latency" },
                  { v: "10", l: "action primitives" },
                  { v: "99.9%", l: "uptime SLA" },
                ].map((m, k) => (
                  <motion.div
                    key={m.l}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.35 + k * 0.08, ease }}
                  >
                    <div className="text-lg font-semibold tabular-nums tracking-tight">{m.v}</div>
                    <div className="text-[10.5px] text-muted-foreground/45 uppercase tracking-wider leading-tight mt-0.5">
                      {m.l}
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            {/* Right — signature device */}
            <div className="hidden lg:block">
              <HeroVisual />
            </div>
          </div>
        </div>
      </section>

      <SectionDivider />

      {/* ─── TRY IT ─── */}
      <section className="py-24 px-7 sm:px-10 relative">
        <div className="mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, ease }}
            className="text-center mb-12"
          >
            <div className="inline-flex items-center gap-2 h-6 px-3 rounded-full border border-border/30 bg-card/30 text-[10px] font-mono text-muted-foreground/60 mb-5">
              <Sparkles className="h-3 w-3" />
              One call. Four lines.
            </div>
            <h2 className="text-[28px] sm:text-4xl font-bold tracking-[-0.02em] mb-4">
              Built for any stack.
            </h2>
            <p className="text-[14px] sm:text-base text-muted-foreground/55 max-w-lg mx-auto">
              Pure REST. No SDK lock-in, no extra servers, no browser drivers.
            </p>
          </motion.div>

          <TryIt />
        </div>
      </section>

      <SectionDivider />

      {/* ─── MACHINES API ─── */}
      <section className="py-24 px-7 sm:px-10 relative">
        <div className="mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, ease }}
            className="text-center mb-12"
          >
            <div className="inline-flex items-center gap-2 h-6 px-3 rounded-full border border-border/30 bg-card/30 text-[10px] font-mono text-muted-foreground/60 mb-5">
              <Monitor className="h-3 w-3" />
              Machines API
            </div>
            <h2 className="text-[28px] sm:text-4xl font-bold tracking-[-0.02em] mb-4">
              Real desktops. Real shells. Real automation.
            </h2>
            <p className="text-[14px] sm:text-base text-muted-foreground/55 max-w-xl mx-auto">
              Provision a sandbox or production VM, then drive it with actions, terminal commands,
              browser automation, or file ops. One auth header, fifteen endpoints.
            </p>
          </motion.div>

          <MachinesTryIt />

          {/* Endpoint chips strip */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: 0.1, ease }}
            className="mt-8 flex flex-wrap justify-center gap-2 max-w-3xl mx-auto"
          >
            {[
              "POST /v1/machines",
              "GET /v1/machines",
              "DELETE /v1/machines/{id}",
              "POST /v1/machines/{id}/start",
              "POST /v1/machines/{id}/stop",
              "POST /v1/machines/{id}/snapshot",
              "GET /v1/machines/{id}/screenshot",
              "GET /v1/machines/{id}/connection",
              "POST /v1/machines/{id}/actions",
              "POST /v1/machines/{id}/actions/batch",
              "POST /v1/machines/{id}/browser/{op}",
              "POST /v1/machines/{id}/terminal",
              "POST /v1/machines/{id}/files/{op}",
            ].map((path) => (
              <code
                key={path}
                className="text-[10px] font-mono text-muted-foreground/55 px-2.5 py-1 rounded-md border border-border/30 bg-card/30"
              >
                {path}
              </code>
            ))}
          </motion.div>
        </div>
      </section>

      <SectionDivider />

      {/* ─── SCHEDULES API ─── */}
      <section className="py-24 px-7 sm:px-10 relative">
        <div className="mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, ease }}
            className="text-center mb-12"
          >
            <div className="inline-flex items-center gap-2 h-6 px-3 rounded-full border border-border/30 bg-card/30 text-[10px] font-mono text-muted-foreground/60 mb-5">
              <Terminal className="h-3 w-3" />
              Schedules API
            </div>
            <h2 className="text-[28px] sm:text-4xl font-bold tracking-[-0.02em] mb-4">
              Cron, webhooks, email, chains.
            </h2>
            <p className="text-[14px] sm:text-base text-muted-foreground/55 max-w-xl mx-auto">
              Run an agent on a cron, fire it from any webhook with HMAC, or chain schedules together.
              Per-fire 10 cr/min · webhook routing 1 cr / 200 fires · sandbox is free.
            </p>
          </motion.div>

          <SchedulesTryIt />

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: 0.1, ease }}
            className="mt-8 flex flex-wrap justify-center gap-2 max-w-3xl mx-auto"
          >
            {[
              "POST /v1/schedules",
              "GET /v1/schedules",
              "PATCH /v1/schedules/{id}",
              "DELETE /v1/schedules/{id}",
              "POST /v1/schedules/{id}/run",
              "POST /v1/schedules/{id}/pause",
              "POST /v1/schedules/{id}/resume",
              "GET /v1/schedules/{id}/runs",
              "GET /v1/schedules/{id}/runs/{run_id}",
              "POST /v1/schedules/{id}/triggers",
              "DELETE /v1/schedules/{id}/triggers/{tid}",
              "POST /v1/triggers/webhook/{wh}  ←  unauth · HMAC",
              "POST /v1/triggers/email-mailbox",
            ].map((path) => (
              <code
                key={path}
                className="text-[10px] font-mono text-muted-foreground/55 px-2.5 py-1 rounded-md border border-border/30 bg-card/30"
              >
                {path}
              </code>
            ))}
          </motion.div>
        </div>
      </section>

      <SectionDivider />

      {/* ─── HOW IT WORKS ─── */}
      <section className="py-24 px-7 sm:px-10">
        <div className="mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, ease }}
            className="text-center mb-16"
          >
            <h2 className="text-[28px] sm:text-4xl font-bold tracking-[-0.02em] mb-4">
              Screenshot in. Actions out.
            </h2>
            <p className="text-[14px] sm:text-base text-muted-foreground/55 max-w-lg mx-auto">
              No selectors. No DOM parsing. No brittle XPath. Just vision.
            </p>
          </motion.div>

          {/* Steps with connecting line */}
          <div className="relative grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-3xl mx-auto mb-20">
            <motion.div
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.9, delay: 0.3, ease }}
              className="hidden sm:block absolute top-5 left-[16.66%] right-[16.66%] h-px bg-gradient-to-r from-transparent via-border/70 to-transparent origin-left"
            />
            {[
              { num: "01", label: "Send screenshot", sub: "Base64 PNG/JPEG + plain-language intent" },
              { num: "02", label: "AI reasons visually", sub: "Vision model identifies the target UI element" },
              { num: "03", label: "Execute actions", sub: "Typed primitives: click, type, scroll, press…" },
            ].map((s, i) => (
              <motion.div
                key={s.num}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.1, ease }}
                className="relative text-center"
              >
                <div className="relative mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-background border border-border/60">
                  <span className="text-[11px] font-mono font-semibold text-foreground/70 tabular-nums">
                    {s.num}
                  </span>
                  <span className="absolute inset-0 rounded-full border border-foreground/10 animate-ping opacity-40" />
                </div>
                <p className="text-sm font-semibold mb-1.5">{s.label}</p>
                <p className="text-[12.5px] text-muted-foreground/50 leading-relaxed max-w-[220px] mx-auto">
                  {s.sub}
                </p>
              </motion.div>
            ))}
          </div>

          {/* Feature grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <FeatureCard
              icon={Eye}
              title="Vision-First"
              description="Works on any UI — web, desktop, mobile, VNC. No DOM access, no selectors, no agents."
              delay={0}
            />
            <FeatureCard
              icon={Layers}
              title="Stateful Sessions"
              description="Multi-step trajectories. The model remembers what it tried, what worked, and what's next."
              delay={0.05}
            />
            <FeatureCard
              icon={Zap}
              title="Two Engines"
              description="V3 for speed (3.5s/step, multi-action). V1 for precision (reflection, single-action)."
              delay={0.1}
            />
            <FeatureCard
              icon={Monitor}
              title="Any Screen"
              description="Browser tabs, desktop apps, mobile emulators, VNC feeds — anything you can capture visually."
              delay={0.15}
            />
            <FeatureCard
              icon={Terminal}
              title="10 Action Types"
              description="click, double_click, type, scroll, drag, key_press, key_combo, wait, done, fail."
              delay={0.2}
            />
            <FeatureCard
              icon={Code2}
              title="Any Language"
              description="Plain REST + JSON. Python, Node, Go, Ruby, PHP, Java, C#, or cURL from your terminal."
              delay={0.25}
            />
          </div>
        </div>
      </section>

      <SectionDivider />

      {/* ─── PRICING ─── */}
      <section className="py-24 px-7 sm:px-10">
        <div className="mx-auto max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, ease }}
            className="text-center mb-12"
          >
            <h2 className="text-[28px] sm:text-4xl font-bold tracking-[-0.02em] mb-4">
              Per-request pricing. No subscription.
            </h2>
            <p className="text-[14px] sm:text-base text-muted-foreground/55 max-w-md mx-auto">
              Deducted from your shared credit balance. Management endpoints always free.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1, ease }}
            className="relative rounded-2xl border border-border/30 bg-card/40 backdrop-blur-sm overflow-hidden"
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.08] to-transparent" />
            {/* header row */}
            <div className="flex items-center gap-4 px-5 py-2.5 border-b border-border/20 bg-foreground/[0.015]">
              <span className="text-[9.5px] font-mono font-semibold text-muted-foreground/45 uppercase tracking-[0.15em] flex-1">
                Endpoint
              </span>
              <span className="text-[9.5px] font-mono font-semibold text-muted-foreground/45 uppercase tracking-[0.15em] hidden sm:block w-44">
                Description
              </span>
              <span className="text-[9.5px] font-mono font-semibold text-muted-foreground/45 uppercase tracking-[0.15em] w-16 text-right">
                Cost
              </span>
            </div>
            <div className="divide-y divide-border/15">
              <PricingRow endpoint="POST /predict" cost="5 cr" description="Screenshot to actions" />
              <PricingRow endpoint="POST /sessions" cost="10 cr" description="Create multi-step session" />
              <PricingRow endpoint="POST /sessions/{id}/predict" cost="4 cr" description="Predict within session" />
              <PricingRow endpoint="POST /ground" cost="3 cr" description="Find element coordinates" />
              <PricingRow endpoint="POST /ocr" cost="3 cr" description="Extract text from image" />
              <PricingRow endpoint="POST /parse" cost="Free" description="Parse action code" highlight />
              <PricingRow
                endpoint="GET /models, /usage, /sessions"
                cost="Free"
                description="Management endpoints"
                highlight
              />
            </div>
          </motion.div>

          {/* Surcharges */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: 0.2, ease }}
            className="mt-4 rounded-xl border border-border/20 bg-card/30 px-5 py-4"
          >
            <p className="text-[10px] font-semibold text-muted-foreground/45 uppercase tracking-[0.15em] mb-3">
              Surcharges
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                ["Trajectory screenshot", "+2 cr each"],
                ["HD image >1280×720", "+1 cr/image"],
                ["V1 engine", "+3 cr/request"],
                ["Custom system prompt", "+1 cr"],
              ].map(([label, cost]) => (
                <div
                  key={label}
                  className="group inline-flex items-center gap-2 h-7 pl-2.5 pr-1 rounded-full border border-border/25 bg-background/50 text-[11px] transition-colors hover:border-border/50"
                >
                  <span className="text-muted-foreground/60">{label}</span>
                  <span className="h-[18px] inline-flex items-center px-1.5 rounded-full bg-foreground/[0.05] font-mono text-[10px] text-foreground/65">
                    {cost}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      <SectionDivider />

      {/* ─── FULL DOCS ─── */}
      <section id="docs" className="py-20 px-7 sm:px-10 scroll-mt-16">
        <div className="mx-auto max-w-5xl">
          <APITab inApp={false} />
        </div>
      </section>

      <SectionDivider />

      {/* ─── CTA ─── */}
      <section className="py-28 px-7 sm:px-10 relative overflow-hidden">
        {/* subtle grid flourish */}
        <div
          className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05] pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)",
            backgroundSize: "32px 32px",
            maskImage: "radial-gradient(ellipse at center, black 30%, transparent 70%)",
          }}
        />
        <div className="relative mx-auto max-w-2xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, ease }}
          >
            <h2 className="text-[28px] sm:text-4xl font-bold tracking-[-0.02em] mb-4">
              Ship your first click in minutes.
            </h2>
            <p className="text-[14px] sm:text-base text-muted-foreground/55 mb-9 max-w-md mx-auto">
              Free account, free keys, free credits to start. No card required.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <PrimaryCTA href="/auth">Create Free Account</PrimaryCTA>
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 rounded-xl border border-border/40 px-6 py-3 text-sm font-medium text-muted-foreground/75 hover:text-foreground hover:border-border/70 transition-all"
              >
                View Plans
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      <LandingFooter />
    </div>
  )
}
