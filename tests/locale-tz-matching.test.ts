/**
 * Tests for locale + timezone matching to (proxy) egress IP.
 *
 * The bot-detection problem: a VM that egresses through, say, a New York
 * residential proxy but reports tz=UTC + Accept-Language=en-US,en is
 * trivially flagged on the locale/tz inconsistency — a bigger tell than
 * spoofing either field alone.
 *
 * Fix in lib/aws/ec2-service.ts: both the Linux (Firefox) and Windows
 * (Chrome) embedded Python agents now do a one-time geo lookup against
 * https://ipinfo.io/json (honoring HTTPS_PROXY) on agent startup, then:
 *   - set os.environ["TZ"] + time.tzset() so the Python process AND its
 *     child Firefox/geckodriver inherit the matched timezone via libc
 *   - set Firefox pref intl.accept_languages (controls Accept-Language
 *     header AND navigator.language)
 *   - pass --lang and intl.accept_languages pref to Chrome on Windows
 *
 * Operator pin: COASTY_TZ + COASTY_LANG env vars override the geo lookup
 * (set in /opt/ai-agent/.env for explicit control).
 *
 * Run: `npx vitest run tests/locale-tz-matching.test.ts`
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { execFileSync, spawnSync } from "child_process";

const SRC = fs.readFileSync(
  path.resolve(__dirname, "..", "lib", "aws", "ec2-service.ts"),
  "utf-8"
);

// Extract the two distinct embedded-agent template-literal bodies. The Linux
// agent is returned by getAgentSource(); the Windows agent by
// getWindowsAgentSource(). Both are inside `return \`...\`;` blocks.
function extractAgent(methodName: string): string {
  const re = new RegExp(
    `${methodName}\\(\\): string \\{\\s*return \`([\\s\\S]*?)\`;\\s*\\}`
  );
  const m = SRC.match(re);
  if (!m) throw new Error(`Could not extract ${methodName} body from ec2-service.ts`);
  return m[1];
}

const LINUX_AGENT = extractAgent("getAgentSource");
const WINDOWS_AGENT = extractAgent("getWindowsAgentSource");

// ═══════════════════════════════════════════════════════════════════════════
// Section 1 — Linux agent: locale resolver presence + integration points
// ═══════════════════════════════════════════════════════════════════════════

describe("Linux agent — locale resolver", () => {
  it("defines _resolve_locale and _apply_tz", () => {
    expect(LINUX_AGENT).toMatch(/def _resolve_locale\(\)/);
    expect(LINUX_AGENT).toMatch(/def _apply_tz\(\)/);
  });

  it("imports urllib.request for the geo lookup", () => {
    expect(LINUX_AGENT).toMatch(/import urllib\.request/);
  });

  it("calls ipinfo.io as the geo provider", () => {
    expect(LINUX_AGENT).toMatch(/https:\/\/ipinfo\.io\/json/);
  });

  it("honors HTTPS_PROXY / https_proxy so geo reflects the proxy IP", () => {
    expect(LINUX_AGENT).toMatch(/HTTPS_PROXY/);
    expect(LINUX_AGENT).toMatch(/https_proxy/);
    // Builds an opener with ProxyHandler when proxy is set
    expect(LINUX_AGENT).toMatch(/ProxyHandler/);
  });

  it("supports COASTY_TZ + COASTY_LANG operator pinning", () => {
    expect(LINUX_AGENT).toMatch(/COASTY_TZ/);
    expect(LINUX_AGENT).toMatch(/COASTY_LANG/);
  });

  it("falls back to America/New_York + en-US when geo lookup fails", () => {
    // Both literals must appear as defaults — this is the "better than UTC"
    // safety net when ipinfo.io is unreachable.
    expect(LINUX_AGENT).toMatch(/America\/New_York/);
    expect(LINUX_AGENT).toMatch(/"en-US"/);
  });

  it("country -> language map covers the major markets", () => {
    for (const pair of [
      `"US":"en-US"`,
      `"GB":"en-GB"`,
      `"CA":"en-CA"`,
      `"DE":"de-DE"`,
      `"FR":"fr-FR"`,
      `"JP":"ja-JP"`,
      `"BR":"pt-BR"`,
      `"IN":"en-IN"`,
      `"CN":"zh-CN"`,
    ]) {
      expect(LINUX_AGENT).toContain(pair);
    }
  });

  it("constructs Accept-Language with q=0.9 fallback (e.g. en-US,en;q=0.9)", () => {
    // The string concatenation that builds the header
    expect(LINUX_AGENT).toMatch(/lang\+","\+base\+";q=0\.9"/);
  });

  it("caches the resolved locale (geo lookup runs once per process)", () => {
    // Single global cache + early-return on hit
    expect(LINUX_AGENT).toMatch(/_LOCALE=None/);
    expect(LINUX_AGENT).toMatch(/if _LOCALE is not None:return _LOCALE/);
  });
});

describe("Linux agent — TZ + browser pref wiring", () => {
  it("_apply_tz mutates os.environ['TZ'] and calls time.tzset", () => {
    expect(LINUX_AGENT).toMatch(/os\.environ\["TZ"\]\s*=\s*loc\["tz"\]/);
    expect(LINUX_AGENT).toMatch(/time\.tzset/);
  });

  it("_get_browser calls _apply_tz BEFORE spawning geckodriver", () => {
    // Anchor on the Firefox launch block; _apply_tz must precede
    // webdriver.Firefox so the child process inherits TZ via libc.
    const launchSlice = LINUX_AGENT.slice(
      LINUX_AGENT.indexOf("def _get_browser"),
      LINUX_AGENT.indexOf("webdriver.Firefox(options=opts)") + 50
    );
    expect(launchSlice).toMatch(/_apply_tz\(\)/);
    // _apply_tz call must appear before the first webdriver.Firefox spawn
    const tzIdx = launchSlice.indexOf("_apply_tz()");
    const ffIdx = launchSlice.indexOf("webdriver.Firefox");
    expect(tzIdx).toBeGreaterThan(-1);
    expect(ffIdx).toBeGreaterThan(tzIdx);
  });

  it("sets Firefox intl.accept_languages preference from resolved locale", () => {
    expect(LINUX_AGENT).toMatch(
      /set_preference\("intl\.accept_languages",loc\["accept"\]\)/
    );
  });

  it("disables javascript.use_us_english_locale so JS Intl follows the lang pref", () => {
    expect(LINUX_AGENT).toMatch(
      /set_preference\("javascript\.use_us_english_locale",False\)/
    );
  });

  it("agent main() calls _apply_tz at startup (not just on first browser cmd)", () => {
    // The ipinfo.io fetch can take ~1s on cold DNS — eagerly resolving at
    // startup eliminates that latency on the first browser_navigate.
    const mainSlice = LINUX_AGENT.slice(LINUX_AGENT.indexOf("async def main"));
    expect(mainSlice).toMatch(/_apply_tz\(\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 2 — Windows agent: same resolver, Chrome-flavored apply
// ═══════════════════════════════════════════════════════════════════════════

describe("Windows agent — locale resolver parity", () => {
  it("defines _resolve_locale and _apply_tz with the same shape", () => {
    expect(WINDOWS_AGENT).toMatch(/def _resolve_locale\(\)/);
    expect(WINDOWS_AGENT).toMatch(/def _apply_tz\(\)/);
    expect(WINDOWS_AGENT).toMatch(/https:\/\/ipinfo\.io\/json/);
    expect(WINDOWS_AGENT).toMatch(/COASTY_TZ/);
    expect(WINDOWS_AGENT).toMatch(/COASTY_LANG/);
  });

  it("passes --lang=<locale> as a Chrome argument", () => {
    expect(WINDOWS_AGENT).toMatch(/--lang=\{loc\['lang'\]\}/);
  });

  it("passes intl.accept_languages via Chrome experimental prefs", () => {
    // Now part of a multi-line `prefs={...}` dict, not inline. Verify both
    // the key/value mapping and the add_experimental_option("prefs", prefs) call.
    expect(WINDOWS_AGENT).toMatch(/"intl\.accept_languages":loc\["accept"\]/);
    expect(WINDOWS_AGENT).toMatch(/add_experimental_option\("prefs",prefs\)/);
  });

  it("Windows main() calls _apply_tz at startup (best-effort, time.tzset is no-op on win)", () => {
    const mainSlice = WINDOWS_AGENT.slice(WINDOWS_AGENT.indexOf("async def main"));
    expect(mainSlice).toMatch(/_apply_tz\(\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 3 — UserData provisions the locales the agent may switch into
// ═══════════════════════════════════════════════════════════════════════════

describe("UserData provisioning", () => {
  it("apt-installs the locales + tzdata packages", () => {
    // Anchor on the apt-get install -y block to avoid matching incidental
    // mentions elsewhere in the file. CRLF tolerant.
    const aptIdx = SRC.indexOf("apt-get install -y");
    expect(aptIdx).toBeGreaterThan(-1);
    const block = SRC.slice(aptIdx, aptIdx + 2000);
    expect(block).toMatch(/\blocales\s+\\\\/);
    expect(block).toMatch(/\btzdata\s+\\\\/);
  });

  it("locale-gen pre-generates the major-market locales (full UserData)", () => {
    // The locale-gen call wraps across many lines — slice a generous window
    // and assert the key entries appear inside it.
    const lgIdx = SRC.indexOf("locale-gen \\\\");
    expect(lgIdx).toBeGreaterThan(-1);
    const window = SRC.slice(lgIdx, lgIdx + 1200);
    for (const lc of [
      "en_US.UTF-8",
      "en_GB.UTF-8",
      "de_DE.UTF-8",
      "fr_FR.UTF-8",
      "es_ES.UTF-8",
      "ja_JP.UTF-8",
      "zh_CN.UTF-8",
      "pt_BR.UTF-8",
      "ru_RU.UTF-8",
    ]) {
      expect(window).toContain(lc);
    }
  });

  it("slim/golden UserData also locale-gens missing locales (idempotent)", () => {
    // Anchor on the slim UserData generator so we know we're inside that
    // bash heredoc, not the full UserData. Then verify the idempotent
    // locale-gen block exists and references representative locales.
    const slimIdx = SRC.indexOf("generateGoldenAmiUserData(vncPassword: string)");
    expect(slimIdx).toBeGreaterThan(-1);
    // Scope to ~6KB after the function start — comfortably covers the body
    const slimBlock = SRC.slice(slimIdx, slimIdx + 6000);
    expect(slimBlock).toMatch(/command -v locale-gen/);
    // Must compute missing set rather than re-generating everything blindly
    expect(slimBlock).toMatch(/locale -a/);
    // Sanity: the needed list contains the same major markets
    expect(slimBlock).toContain("en_US.UTF-8");
    expect(slimBlock).toContain("de_DE.UTF-8");
    expect(slimBlock).toContain("ja_JP.UTF-8");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 4 — Runtime test: extract the Python resolver, exec it, assert
//             behavior across pinned / geo / fallback paths.
//
// Skipped automatically when python3 isn't on PATH (e.g. minimal CI).
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

// Build a minimal Python harness that imports json/os/urllib.request, monkey-
// patches urllib.request.urlopen and build_opener to return a chosen JSON,
// then defines the same _resolve_locale function from the Linux agent and
// prints the resolved dict as JSON for assertion.
function buildHarness(opts: {
  env: Record<string, string>;
  ipinfoBody?: string | null;     // null = simulate network failure
  expectProxyUsed?: boolean;
}): { script: string; env: NodeJS.ProcessEnv } {
  const ipinfoJson = opts.ipinfoBody === undefined
    ? `{"timezone":"America/Los_Angeles","country":"US"}`
    : opts.ipinfoBody;

  // Re-extract the Linux agent's resolver function source verbatim so we
  // exercise the SAME code that ships in production. The function spans
  // from `_COUNTRY_LANG=` through the end of `_apply_tz`.
  const startMarker = "_COUNTRY_LANG={";
  const endMarker = "def _apply_tz():";
  const startIdx = LINUX_AGENT.indexOf(startMarker);
  const applyTzIdx = LINUX_AGENT.indexOf(endMarker);
  if (startIdx < 0 || applyTzIdx < 0) {
    throw new Error("Could not locate resolver function in Linux agent");
  }
  // Include _apply_tz too (ends at the next blank line / `class ` / `async def`)
  const afterApply = LINUX_AGENT.slice(applyTzIdx);
  const applyEnd = afterApply.search(/\n(?:class |async def |def [^_]|[^ \t\n])/);
  const resolverSrc = LINUX_AGENT.slice(
    startIdx,
    applyTzIdx + (applyEnd > 0 ? applyEnd : afterApply.length)
  );

  // Harness wraps urllib so the resolver's internal urlopen/build_opener
  // returns our canned ipinfo response without any real network IO.
  const harness = `
import io, json, os, sys, time
import urllib.request

_PROXY_USED = {"value": False}
_NETWORK_OK = ${opts.ipinfoBody === null ? "False" : "True"}
_BODY = ${JSON.stringify(ipinfoJson ?? "")}

class _FakeResp:
    def __init__(self, body):
        self._buf = io.BytesIO(body.encode("utf-8"))
    def read(self):
        return self._buf.read()

class _FakeOpener:
    def __init__(self, with_proxy):
        self._with_proxy = with_proxy
    def open(self, req, timeout=None):
        if self._with_proxy:
            _PROXY_USED["value"] = True
        if not _NETWORK_OK:
            raise OSError("simulated network failure")
        return _FakeResp(_BODY)

def _fake_build_opener(*handlers):
    has_proxy = any(isinstance(h, urllib.request.ProxyHandler) for h in handlers)
    return _FakeOpener(has_proxy)

urllib.request.build_opener = _fake_build_opener

# ===== Verbatim resolver from production agent =====
${resolverSrc}
# ===== End verbatim =====

loc = _resolve_locale()
print("RESULT:" + json.dumps({
    "tz": loc["tz"],
    "lang": loc["lang"],
    "accept": loc["accept"],
    "country": loc["country"],
    "proxy_used": _PROXY_USED["value"],
}))
`;
  const env: NodeJS.ProcessEnv = { ...process.env, ...opts.env };
  // Strip any inherited COASTY_* vars unless explicitly set by the test
  if (!("COASTY_TZ" in opts.env)) delete env.COASTY_TZ;
  if (!("COASTY_LANG" in opts.env)) delete env.COASTY_LANG;
  if (!("HTTPS_PROXY" in opts.env)) delete env.HTTPS_PROXY;
  if (!("https_proxy" in opts.env)) delete env.https_proxy;
  return { script: harness, env };
}

function runHarness(h: ReturnType<typeof buildHarness>): {
  tz: string;
  lang: string;
  accept: string;
  country: string;
  proxy_used: boolean;
} {
  const out = execFileSync(PY!, ["-c", h.script], {
    env: h.env,
    encoding: "utf8",
    timeout: 15000,
  });
  const line = out.split("\n").find((l) => l.startsWith("RESULT:"));
  if (!line) throw new Error(`Harness produced no RESULT line. stdout:\n${out}`);
  return JSON.parse(line.slice("RESULT:".length));
}

describeIfPy("Linux resolver — runtime behavior (executed against real Python)", () => {
  it("uses geo response: timezone + country -> language", () => {
    const r = runHarness(
      buildHarness({
        env: {},
        ipinfoBody: `{"timezone":"Europe/Berlin","country":"DE"}`,
      })
    );
    expect(r.tz).toBe("Europe/Berlin");
    expect(r.lang).toBe("de-DE");
    expect(r.accept).toBe("de-DE,de;q=0.9");
    expect(r.country).toBe("DE");
    expect(r.proxy_used).toBe(false);
  });

  it("US geo -> en-US,en;q=0.9", () => {
    const r = runHarness(
      buildHarness({
        env: {},
        ipinfoBody: `{"timezone":"America/Los_Angeles","country":"US"}`,
      })
    );
    expect(r.tz).toBe("America/Los_Angeles");
    expect(r.lang).toBe("en-US");
    expect(r.accept).toBe("en-US,en;q=0.9");
  });

  it("falls back to America/New_York + en-US on geo failure", () => {
    const r = runHarness(buildHarness({ env: {}, ipinfoBody: null }));
    expect(r.tz).toBe("America/New_York");
    expect(r.lang).toBe("en-US");
    expect(r.accept).toBe("en-US,en;q=0.9");
  });

  it("HTTPS_PROXY routes the geo lookup through the proxy", () => {
    const r = runHarness(
      buildHarness({
        env: { HTTPS_PROXY: "http://user:pass@proxy.example:8080" },
        ipinfoBody: `{"timezone":"Asia/Tokyo","country":"JP"}`,
      })
    );
    expect(r.proxy_used).toBe(true);
    expect(r.tz).toBe("Asia/Tokyo");
    expect(r.lang).toBe("ja-JP");
  });

  it("COASTY_TZ + COASTY_LANG fully override the geo lookup", () => {
    // When both are pinned, no network call should happen (we'd see the
    // canned ipinfo body otherwise). Use ipinfoBody=null to prove geo is
    // skipped — if the resolver tried to fetch, it'd raise and fall back
    // to America/New_York + en-US, which would NOT match our pin.
    const r = runHarness(
      buildHarness({
        env: { COASTY_TZ: "Europe/London", COASTY_LANG: "en-GB" },
        ipinfoBody: null,
      })
    );
    expect(r.tz).toBe("Europe/London");
    expect(r.lang).toBe("en-GB");
    expect(r.accept).toBe("en-GB,en;q=0.9");
  });

  it("COASTY_TZ alone still does geo lookup for country -> lang", () => {
    const r = runHarness(
      buildHarness({
        env: { COASTY_TZ: "Pacific/Auckland" },
        ipinfoBody: `{"timezone":"America/Los_Angeles","country":"NZ"}`,
      })
    );
    expect(r.tz).toBe("Pacific/Auckland"); // pin wins
    expect(r.lang).toBe("en-NZ"); // from geo country
  });

  it("unknown country code falls back to en-US (not crash)", () => {
    const r = runHarness(
      buildHarness({
        env: {},
        ipinfoBody: `{"timezone":"Africa/Nairobi","country":"XX"}`,
      })
    );
    expect(r.tz).toBe("Africa/Nairobi");
    expect(r.lang).toBe("en-US");
  });

  it("malformed geo body (missing fields) falls back cleanly", () => {
    const r = runHarness(
      buildHarness({
        env: {},
        ipinfoBody: `{}`,
      })
    );
    expect(r.tz).toBe("America/New_York");
    expect(r.lang).toBe("en-US");
    expect(r.country).toBe("");
  });
});
