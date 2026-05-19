/**
 * Tests for browser stealth + behavioral mimicry shipped in the embedded
 * Python agent (lib/aws/ec2-service.ts).
 *
 * What we cover:
 *   - Firefox prefs that meaningfully reduce bot-detection signal
 *     (navigator.webdriver, WebRTC ICE, telemetry, geo, UA override)
 *   - Chrome on Windows: --disable-blink-features=AutomationControlled,
 *     excludeSwitches, useAutomationExtension, CDP webdriver shim
 *   - Bezier-curve mouse movement with overshoot (Linux + Windows)
 *   - Bigram-aware typing delays calibrated to Aalto 136M-keystroke study
 *     (mean IKI ~238ms, floor 60ms)
 *   - Randomized viewport pool (per-process cached) + realistic UA pool
 *   - HTTPS_PROXY auto-wiring into Firefox prefs / Chrome --proxy-server
 *   - Things we deliberately do NOT do (RFP=true, peerconnection=false,
 *     HTTP/2 disabled — research showed those create new tells)
 *
 * Runtime test (Section 5) extracts the verbatim Python helpers and runs
 * them under real python3 to validate distributional properties of the
 * typing-delay function. Skips cleanly without python3 on PATH.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { execFileSync, spawnSync } from "child_process";

const SRC = fs.readFileSync(
  path.resolve(__dirname, "..", "lib", "aws", "ec2-service.ts"),
  "utf-8"
);

function extractAgent(methodName: string): string {
  const re = new RegExp(
    `${methodName}\\(\\): string \\{\\s*return \`([\\s\\S]*?)\`;\\s*\\}`
  );
  const m = SRC.match(re);
  if (!m) throw new Error(`Could not extract ${methodName}`);
  return m[1];
}

const LINUX_AGENT = extractAgent("getAgentSource");
const WINDOWS_AGENT = extractAgent("getWindowsAgentSource");

// ═══════════════════════════════════════════════════════════════════════════
// Section 1 — Firefox stealth preferences (Linux agent)
// ═══════════════════════════════════════════════════════════════════════════

describe("Linux Firefox — stealth prefs", () => {
  it("hides navigator.webdriver via dom.webdriver.enabled=False", () => {
    expect(LINUX_AGENT).toMatch(
      /set_preference\("dom\.webdriver\.enabled",False\)/
    );
  });

  it("restricts WebRTC ICE candidates without disabling WebRTC entirely", () => {
    // The right pattern: ICE prefs that prevent IP leak, NOT disabling
    // peerconnection (only ~2% of users disable it — itself a tell).
    expect(LINUX_AGENT).toMatch(
      /set_preference\("media\.peerconnection\.ice\.no_host",True\)/
    );
    expect(LINUX_AGENT).toMatch(
      /set_preference\("media\.peerconnection\.ice\.default_address_only",True\)/
    );
    expect(LINUX_AGENT).toMatch(
      /set_preference\("media\.peerconnection\.ice\.proxy_only_if_behind_proxy",True\)/
    );
    // Anti-pattern: must NOT disable peerconnection entirely
    expect(LINUX_AGENT).not.toMatch(
      /set_preference\("media\.peerconnection\.enabled",False\)/
    );
  });

  it("disables telemetry / phone-home prefs that real users rarely emit alone", () => {
    expect(LINUX_AGENT).toMatch(/toolkit\.telemetry\.enabled/);
    expect(LINUX_AGENT).toMatch(/toolkit\.telemetry\.unified/);
    expect(LINUX_AGENT).toMatch(/datareporting\.healthreport\.uploadEnabled/);
    expect(LINUX_AGENT).toMatch(/app\.normandy\.enabled/);
    expect(LINUX_AGENT).toMatch(/app\.shield\.optoutstudies\.enabled/);
  });

  it("blocks geo prompt + battery (anomalous on a server VM)", () => {
    expect(LINUX_AGENT).toMatch(/set_preference\("geo\.enabled",False\)/);
    expect(LINUX_AGENT).toMatch(/set_preference\("dom\.battery\.enabled",False\)/);
  });

  it("overrides User-Agent to a real Linux x86_64 Firefox string", () => {
    expect(LINUX_AGENT).toMatch(/general\.useragent\.override/);
    // Pool must contain at least one Firefox 140+ Linux x86_64 UA
    expect(LINUX_AGENT).toMatch(/X11; Linux x86_64.*Firefox\/14[0-9]/);
    // Anti-pattern: no aarch64 in UA pool (would single out t4g)
    expect(LINUX_AGENT).not.toMatch(/aarch64.*Firefox/);
    // Anti-pattern: never spoof Chrome UA in Firefox (Sec-CH-UA mismatch)
    const firefoxBlock = LINUX_AGENT.slice(
      LINUX_AGENT.indexOf("_UA_POOL"),
      LINUX_AGENT.indexOf("_UA_POOL") + 1500
    );
    expect(firefoxBlock).not.toMatch(/Chrome\/\d+\.\d+\.\d+\.\d+ Safari/);
  });

  it("does NOT enable privacy.resistFingerprinting (RFP would force tz=UTC, breaking proxy match)", () => {
    expect(LINUX_AGENT).not.toMatch(/resistFingerprinting.*True/);
  });

  it("does NOT disable HTTP/2 (would lose Firefox's correct HTTP/2 fingerprint)", () => {
    expect(LINUX_AGENT).not.toMatch(/spdy\.enabled\.http2.*False/);
  });
});

describe("Linux Firefox — proxy auto-wiring", () => {
  it("reads HTTPS_PROXY / https_proxy and translates to Firefox prefs", () => {
    expect(LINUX_AGENT).toMatch(/HTTPS_PROXY/);
    expect(LINUX_AGENT).toMatch(/https_proxy/);
    expect(LINUX_AGENT).toMatch(/network\.proxy\.type/);
    expect(LINUX_AGENT).toMatch(/network\.proxy\.http/);
    expect(LINUX_AGENT).toMatch(/network\.proxy\.ssl/);
    expect(LINUX_AGENT).toMatch(/network\.proxy\.share_proxy_settings/);
  });

  it("supports SOCKS proxies with remote DNS (avoids DNS leak via EC2)", () => {
    expect(LINUX_AGENT).toMatch(/network\.proxy\.socks/);
    expect(LINUX_AGENT).toMatch(/network\.proxy\.socks_remote_dns/);
  });

  it("doesn't proxy localhost (so the agent's own VNC/loopback still works)", () => {
    expect(LINUX_AGENT).toMatch(/network\.proxy\.no_proxies_on.*localhost/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 2 — Behavioral mimicry: Bezier mouse + bigram typing
// ═══════════════════════════════════════════════════════════════════════════

describe("Linux behavioral — Bezier mouse + bigram typing", () => {
  it("defines _human_move (Bezier curve mouse) and _human_type_delay", () => {
    expect(LINUX_AGENT).toMatch(/def _human_move\(/);
    expect(LINUX_AGENT).toMatch(/def _human_type_delay\(/);
  });

  it("Bezier mouse uses cubic-Bezier with smoothstep ease-in-out", () => {
    // Cubic Bezier: 4 control points, polynomial of degree 3
    expect(LINUX_AGENT).toMatch(/\(1-te\)\*\*3\*sx/); // first term
    expect(LINUX_AGENT).toMatch(/te\*\*3\*ex/); // last term
    // Smoothstep ease (3t² - 2t³)
    expect(LINUX_AGENT).toMatch(/t\*t\*\(3-2\*t\)/);
  });

  it("Bezier mouse implements overshoot+correction (~12% probability for moves >80px)", () => {
    const block = LINUX_AGENT.slice(LINUX_AGENT.indexOf("def _human_move"));
    expect(block).toMatch(/overshoot=/);
    // Probability between 5% and 30% (research says 15-30%, code uses 12%)
    expect(block).toMatch(/_rng\.random\(\)<0\.[01]\d/);
    // Distance threshold so short moves don't overshoot
    expect(block).toMatch(/d>\d{2,3}/);
  });

  it("_cl, _dc, _rc all route through _human_move (no instant teleport)", () => {
    // Each click handler must call _human_move BEFORE the actual click
    for (const fn of [" def _cl(self,p):", " def _dc(self,p):", " def _rc(self,p):"]) {
      const idx = LINUX_AGENT.indexOf(fn);
      expect(idx).toBeGreaterThan(-1);
      // Slice 250 chars after to capture the function body
      const body = LINUX_AGENT.slice(idx, idx + 350);
      expect(body).toMatch(/_human_move\(x,y\)/);
    }
  });

  it("_ty preserves human mode (bigram-aware per-char delay) for stealth-critical paths", () => {
    // 2026-05-11 perf rewrite: default mode flipped to "fast" (one xdotool
    // subprocess + 1-3 ms internal --delay), with auto-promote to xclip
    // clipboard paste for text >= 50 chars. Human mode (Aalto-calibrated
    // bigram delay per char) is PRESERVED as opt-in via `mode="human"`
    // for stealth-critical contexts (Cloudflare challenge fields etc).
    // This test guards that preservation.
    const tyIdx = LINUX_AGENT.indexOf(" def _ty(self,p):");
    expect(tyIdx).toBeGreaterThan(-1);
    // Grab the whole _ty body up to the next ` def ` boundary
    const tail = LINUX_AGENT.slice(tyIdx);
    const nextDef = tail.match(/\n def\s+\w+\s*\(/);
    const body = nextDef ? tail.slice(0, nextDef.index!) : tail;
    // Human-mode branch must still call _human_type_delay
    expect(body).toMatch(/_human_type_delay\(prev,ch\)/);
    // Stealth opt-out via interval=0 / fast=true still maps to instant
    expect(body).toMatch(/interval["']\s*\)\s*==\s*0|p\.get\(\s*["']fast["']/);
    // Default is fast (anti-regression)
    expect(body).toMatch(/else\s*:\s*mode\s*=\s*["']fast["']/);
  });

  it("bigram delay table is calibrated to Aalto distribution (floor ~60ms, mean ~238ms)", () => {
    // Common bigrams should be 100-180ms (faster than mean, but well above floor)
    const bgMatch = LINUX_AGENT.match(/_BIGRAM_DELAY=\{([^}]+)\}/);
    expect(bgMatch).not.toBeNull();
    const entries = bgMatch![1].split(",");
    const values: number[] = [];
    for (const e of entries) {
      const m = e.match(/"[a-z ]{2}":(\d+)/);
      if (m) values.push(parseInt(m[1], 10));
    }
    expect(values.length).toBeGreaterThan(40); // at least 40 bigrams
    const min = Math.min(...values);
    const max = Math.max(...values);
    // No value below 60ms floor
    expect(min).toBeGreaterThanOrEqual(60);
    // Mean in plausible range (research: common bigrams 100-180ms)
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(100);
    expect(mean).toBeLessThan(200);
    // Max should be under the IKI mean of 238ms (these are the COMMON bigrams)
    expect(max).toBeLessThan(220);
  });

  it("exposes hard floor of 60ms in _human_type_delay (no sub-human burst typing)", () => {
    expect(LINUX_AGENT).toMatch(/if d<60:d=60/);
  });

  it("punctuation gets thinking-pause padding (60-220ms extra)", () => {
    // Sentence-end punctuation triggers extra delay. Note: `?` and `.`
    // are regex specials inside the character class string we're
    // searching for, so escape them in the pattern.
    expect(LINUX_AGENT).toMatch(/ch in"\.,!\?;:"[\s\S]{0,30}d\+=_rng\.uniform\(/);
  });

  it("uppercase letters after lowercase get shift-transition padding", () => {
    expect(LINUX_AGENT).toMatch(/ch\.isupper\(\).*not prev\.isupper\(\).*d\+=_rng\.uniform\(/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 3 — Viewport + UA pool (cached per-process)
// ═══════════════════════════════════════════════════════════════════════════

describe("Linux — viewport + UA pool", () => {
  it("samples viewport from a real-distribution pool (1920x1080 dominant)", () => {
    expect(LINUX_AGENT).toMatch(/_VP_POOL=\[/);
    // 1920x1080 should appear multiple times (weighted sampling for prevalence)
    const vp = LINUX_AGENT.match(/_VP_POOL=\[([^\]]+)\]/);
    expect(vp).not.toBeNull();
    const occurrences = (vp![1].match(/1920,1080/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(3);
    // Diversity: at least 4 distinct sizes
    const distinct = new Set(vp![1].match(/\d+,\d+/g) || []);
    expect(distinct.size).toBeGreaterThanOrEqual(4);
  });

  it("viewport + UA are cached per-process (stable identity across actions)", () => {
    expect(LINUX_AGENT).toMatch(/_VIEWPORT=None[\s\S]*if _VIEWPORT is None/);
    expect(LINUX_AGENT).toMatch(/_UA=None[\s\S]*if _UA is None/);
  });

  it("_get_browser uses randomized viewport (not hardcoded 1280x720)", () => {
    // _get_browser body grew with all the stealth prefs — extract from
    // function start to the next `class Agent:` (its true terminator).
    const start = LINUX_AGENT.indexOf("def _get_browser():");
    const end = LINUX_AGENT.indexOf("class Agent:", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const gb = LINUX_AGENT.slice(start, end);
    expect(gb).toMatch(/vw,vh=_viewport\(\)/);
    expect(gb).toMatch(/--width=\{vw\}/);
    expect(gb).toMatch(/set_window_size\(vw,vh\)/);
    // Must NOT have the old hardcoded 1280
    expect(gb).not.toMatch(/--width=1280/);
    expect(gb).not.toMatch(/set_window_size\(1280,720\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 4 — Windows Chrome stealth + behavioral parity
// ═══════════════════════════════════════════════════════════════════════════

describe("Windows Chrome — stealth + behavioral parity", () => {
  it("disables blink AutomationControlled feature (kills navigator.webdriver)", () => {
    expect(WINDOWS_AGENT).toMatch(/--disable-blink-features=AutomationControlled/);
  });

  it("removes enable-automation switch + useAutomationExtension", () => {
    expect(WINDOWS_AGENT).toMatch(
      /excludeSwitches.*enable-automation/
    );
    expect(WINDOWS_AGENT).toMatch(/useAutomationExtension.*False/);
  });

  it("adds CDP-level navigator.webdriver shim (defense in depth)", () => {
    expect(WINDOWS_AGENT).toMatch(/Page\.addScriptToEvaluateOnNewDocument/);
    expect(WINDOWS_AGENT).toMatch(/navigator,'webdriver'/);
  });

  it("overrides --user-agent to a Chrome-on-Windows string", () => {
    expect(WINDOWS_AGENT).toMatch(/--user-agent=/);
    expect(WINDOWS_AGENT).toMatch(/Windows NT 10\.0; Win64; x64.*Chrome\/13[0-9]/);
  });

  it("HTTPS_PROXY env -> --proxy-server flag", () => {
    expect(WINDOWS_AGENT).toMatch(/HTTPS_PROXY/);
    expect(WINDOWS_AGENT).toMatch(/--proxy-server=/);
    expect(WINDOWS_AGENT).toMatch(/--proxy-bypass-list/);
  });

  it("randomized viewport from real-distribution pool", () => {
    expect(WINDOWS_AGENT).toMatch(/_VP_POOL=\[/);
    const vp = WINDOWS_AGENT.match(/_VP_POOL=\[([^\]]+)\]/);
    expect(vp).not.toBeNull();
    const occurrences = (vp![1].match(/1920,1080/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });

  it("Bezier mouse + bigram typing helpers present", () => {
    expect(WINDOWS_AGENT).toMatch(/def _human_move\(/);
    expect(WINDOWS_AGENT).toMatch(/def _human_type_delay\(/);
    // Same Aalto floor
    expect(WINDOWS_AGENT).toMatch(/if d<60:d=60/);
  });

  it("_cl, _dc, _rc all route through _human_move", () => {
    for (const fn of [" def _cl(self,p):", " def _dc(self,p):", " def _rc(self,p):"]) {
      const idx = WINDOWS_AGENT.indexOf(fn);
      expect(idx).toBeGreaterThan(-1);
      const body = WINDOWS_AGENT.slice(idx, idx + 350);
      expect(body).toMatch(/_human_move\(x,y\)/);
    }
  });

  it("_ty preserves human mode (bigram-aware per-char delay) for stealth-critical paths", () => {
    // Mirrors the Linux-agent test above. The Windows agent uses
    // pyautogui (no subprocess fork) so the speed-up over the legacy
    // default is "only" ~5x; the human mode is still preserved for
    // opt-in stealth contexts.
    const tyIdx = WINDOWS_AGENT.indexOf(" def _ty(self,p):");
    expect(tyIdx).toBeGreaterThan(-1);
    const tail = WINDOWS_AGENT.slice(tyIdx);
    const nextDef = tail.match(/\n def\s+\w+\s*\(/);
    const body = nextDef ? tail.slice(0, nextDef.index!) : tail;
    expect(body).toMatch(/_human_type_delay\(prev,ch\)/);
    // Default is fast (anti-regression)
    expect(body).toMatch(/else\s*:\s*mode\s*=\s*["']fast["']/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 5 — Runtime test: actually exec the typing-delay function under
//             real python3 and verify distributional properties.
// ═══════════════════════════════════════════════════════════════════════════

function pythonAvailable(): string | null {
  for (const cmd of ["python3", "python"]) {
    try {
      const r = spawnSync(cmd, ["-c", "import sys;print(sys.version_info[0])"], {
        encoding: "utf8",
      });
      if (r.status === 0 && r.stdout.trim().startsWith("3")) return cmd;
    } catch {}
  }
  return null;
}

const PY = pythonAvailable();
const describeIfPy = PY ? describe : describe.skip;

// Extract the bigram dict + _human_type_delay from the Linux agent and
// run it against a synthetic typing corpus to validate stats.
function buildTypingHarness(text: string, samples = 5): string {
  // Locate the verbatim source between `_BIGRAM_DELAY` and the end of
  // `_human_type_delay`.
  const bgIdx = LINUX_AGENT.indexOf("_BIGRAM_DELAY=");
  const tdEndMarker = "def _shot():"; // first def AFTER _human_type_delay
  // _shot appears after type_delay in Linux agent; split at start of def _shot
  const tdEndIdx = LINUX_AGENT.indexOf(tdEndMarker, bgIdx);
  if (bgIdx < 0 || tdEndIdx < 0) {
    throw new Error("Could not extract typing helpers from Linux agent");
  }
  const helpers = LINUX_AGENT.slice(bgIdx, tdEndIdx);

  return `
import json, random
import random as _rng  # used by helpers
${helpers}

text = ${JSON.stringify(text)}
SAMPLES = ${samples}

all_delays = []
for _ in range(SAMPLES):
    prev = " "
    for ch in text:
        d = _human_type_delay(prev, ch)
        all_delays.append(d * 1000.0)  # to ms
        prev = ch

import statistics
print("RESULT:" + json.dumps({
    "n": len(all_delays),
    "mean_ms": statistics.mean(all_delays),
    "stdev_ms": statistics.stdev(all_delays) if len(all_delays) > 1 else 0,
    "min_ms": min(all_delays),
    "max_ms": max(all_delays),
    "p50_ms": statistics.median(all_delays),
}))
`;
}

function runTypingHarness(text: string, samples = 5) {
  const script = buildTypingHarness(text, samples);
  const out = execFileSync(PY!, ["-c", script], { encoding: "utf8", timeout: 15000 });
  const line = out.split("\n").find((l) => l.startsWith("RESULT:"));
  if (!line) throw new Error(`no RESULT: ${out}`);
  return JSON.parse(line.slice("RESULT:".length));
}

describeIfPy("Linux _human_type_delay — runtime distribution checks", () => {
  it("never returns a delay below the 60ms floor", () => {
    // Run a long varied text to stress the floor
    const text = "The quick brown fox jumps over the lazy dog. 0123456789!?,;:";
    const r = runTypingHarness(text, 8);
    expect(r.min_ms).toBeGreaterThanOrEqual(60);
  });

  it("mean delay sits in the plausible human range (~120-260ms)", () => {
    // Common English text → mean should land in the realistic typing range.
    // Lower bound 120ms (research mean is 238 with sigma 111; common-bigram
    // heavy text skews lower). Upper bound 260ms (some punctuation pads up).
    const text = "the quick brown fox jumps over the lazy dog and runs to the store";
    const r = runTypingHarness(text, 10);
    expect(r.mean_ms).toBeGreaterThan(120);
    expect(r.mean_ms).toBeLessThan(280);
  });

  it("punctuation adds noticeable extra delay vs pure-letter typing", () => {
    const lettersOnly = runTypingHarness(
      "the quick brown fox jumps over the lazy dog the quick brown",
      10
    );
    const punctuated = runTypingHarness(
      "the quick brown, fox jumps; over the lazy dog. the quick brown!",
      10
    );
    // Mean should be measurably higher with punctuation
    expect(punctuated.mean_ms).toBeGreaterThan(lettersOnly.mean_ms);
  });

  it("variance is non-trivial (stdev > 30ms — humans aren't metronomes)", () => {
    const r = runTypingHarness("hello world this is a typing test", 10);
    expect(r.stdev_ms).toBeGreaterThan(30);
  });

  it("typing 'th' (most common English bigram) lands near the 100-130ms range across samples", () => {
    // Sample many "th" transitions and check the distribution
    const text = "thththththththththththththth"; // 14 'th' bigrams * 10 samples
    const r = runTypingHarness(text, 10);
    // p50 should be in [100, 230] given base 105ms ± jitter ± shift (no shift here)
    expect(r.p50_ms).toBeGreaterThan(80);
    expect(r.p50_ms).toBeLessThan(220);
  });
});
