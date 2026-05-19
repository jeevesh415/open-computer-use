/**
 * Boot-speed optimizations — regression tests.
 *
 * The slim/golden UserData and systemd services were tuned to minimize
 * "VM created → desktop ready" latency. These tests guard against
 * accidental regressions of those wins.
 *
 * Wins covered:
 *   1. Slim UserData restarts services with --no-block (queues with
 *      systemd's After=/Wants= chain, returns instantly). Saves ~10s
 *      vs sequential `systemctl restart` waits.
 *   2. Slim UserData drops redundant `daemon-reload` + `enable` —
 *      those are already done in the golden AMI.
 *   3. Slim UserData drops the `sleep 3` between vncserver and novnc
 *      restarts (noVNC's own ExecStartPre waits for port 5901). Saves 3s.
 *   4. Slim UserData runs locale-gen FULLY in background — agent doesn't
 *      need locales at startup (TZ/lang via env at runtime).
 *   5. Slim UserData backgrounds the service-stop step in parallel with
 *      file setup. Saves ~2-3s.
 *   6. Slim UserData calls `systemctl reset-failed` to clear backoff so
 *      restart fires immediately even if a prior boot crashed.
 *   7. Full UserData starts vncserver + novnc in parallel via --no-block
 *      (drops `sleep 5`). Saves 5s on cold boots.
 *   8. systemd ExecStartPre xdpyinfo wait uses sleep 0.2 (5Hz) instead
 *      of sleep 1 (1Hz). Detects X server readiness ~5x faster.
 *   9. systemd ExecStartPre port :5901 wait uses sleep 0.2 (5Hz) too.
 *  10. Orchestrator polls noVNC :6080 every 1.5s (vs 5s previously) so
 *      ready detection latency drops from up to 5s to up to 1.5s.
 *
 * Run: `npx vitest run tests/boot-speed.test.ts`
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = fs.readFileSync(
  path.resolve(__dirname, "..", "lib", "aws", "ec2-service.ts"),
  "utf-8"
);

const ROUTE_SRC = fs.readFileSync(
  path.resolve(__dirname, "..", "app", "api", "machines", "route.ts"),
  "utf-8"
);

// Extract the slim/golden UserData script body
function slimUserDataBody(): string {
  const m = SRC.match(
    /generateGoldenAmiUserData\(vncPassword: string\): string \{[\s\S]*?const script = `([\s\S]*?)`;/
  );
  if (!m) throw new Error("could not extract slim UserData script");
  return m[1];
}

// Extract the full UserData script body (cold-Ubuntu path)
function fullUserDataBody(): string {
  const m = SRC.match(
    /generateDesktopUserData\(vncPassword: string\): string \{[\s\S]*?const script = `([\s\S]*?)`;[\s\S]*?const minified = this\.minifyBash/
  );
  if (!m) throw new Error("could not extract full UserData script");
  return m[1];
}

const SLIM = slimUserDataBody();
const FULL = fullUserDataBody();

// ═══════════════════════════════════════════════════════════════════════════
// Section 1 — Slim UserData parallelization wins
// ═══════════════════════════════════════════════════════════════════════════

describe("Slim UserData — service restart parallelization", () => {
  it("restarts ALL services in a single --no-block call (no sequential waits)", () => {
    expect(SLIM).toMatch(
      /systemctl restart --no-block vncserver@:1\.service novnc\.service keep-screen-alive\.service ai-agent\.service memory-watchdog\.service/
    );
  });

  it("does NOT have the old sequential restart chain", () => {
    // The old pattern was:
    //   systemctl restart vncserver@:1.service
    //   sleep 3
    //   systemctl restart novnc.service
    //   ...
    // If anyone reintroduces it, this catches it.
    expect(SLIM).not.toMatch(/systemctl restart vncserver@:1\.service\n+sleep/);
    // The redundant `sleep 3` between vnc + novnc must be gone
    expect(SLIM).not.toMatch(/^sleep 3$/m);
  });

  it("drops redundant daemon-reload + enable on slim path (golden AMI has them)", () => {
    // In the slim path specifically, these are wasted CPU.
    expect(SLIM).not.toMatch(/^systemctl daemon-reload$/m);
    expect(SLIM).not.toMatch(/^systemctl enable vncserver@:1\.service novnc/m);
  });

  it("calls systemctl reset-failed to clear backoff before restart", () => {
    // Without this, a service that crashed on a prior boot stays in the
    // "failed" state with restart backoff — restart triggers a delay.
    expect(SLIM).toMatch(/systemctl reset-failed/);
  });
});

describe("Slim UserData — concurrent setup", () => {
  it("backgrounds the service-stop step (file setup runs in parallel)", () => {
    // The stop must be backgrounded with `&` and we must `wait` for it
    // before restarting (avoid systemd "queued restart while stopping").
    // CRLF-tolerant regex.
    expect(SLIM).toMatch(/systemctl stop[^&\r\n]*&\s*\r?\n/);
    expect(SLIM).toMatch(/wait \$SVCS_STOP_PID/);
  });

  it("masks Ubuntu cruft services (snapd, apport, unattended-upgrades, etc.) for ~5-10s boot savings", () => {
    expect(SLIM).toMatch(/systemctl mask --now/);
    // Each service that consumed boot time on stock Ubuntu Server
    for (const svc of [
      "snapd.service",
      "snapd.socket",
      "unattended-upgrades.service",
      "apport.service",
      "ModemManager.service",
      "bluetooth.service",
      "cups.service",
      "fwupd.service",
      "apt-daily.timer",
    ]) {
      expect(SLIM).toContain(svc);
    }
  });

  it("runs locale-gen FULLY in background (agent sets locale via env at runtime)", () => {
    // Look for the locale-gen subshell with trailing &
    // Pattern: ( ... locale-gen ... ) &
    const m = SLIM.match(/\(\s*\n[\s\S]*?locale-gen[\s\S]*?\)\s*&/);
    expect(m, "locale-gen subshell must end with &").not.toBeNull();
  });

  it("does not synchronously block on locale-gen completion (no `wait $LG_PID`)", () => {
    // We deliberately do NOT wait for locale-gen; agent reads TZ at
    // runtime so missing locales don't block boot.
    expect(SLIM).not.toMatch(/wait \$LG_PID/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 2 — Full UserData (cold-Ubuntu path) parallelization wins
// ═══════════════════════════════════════════════════════════════════════════

describe("Full UserData — cold-boot parallelization", () => {
  it("starts vncserver + novnc in parallel via --no-block (drops sleep 5)", () => {
    expect(FULL).toMatch(
      /systemctl start --no-block vncserver@:1\.service novnc\.service/
    );
    // The old `sleep 5` between vnc and novnc must be gone
    expect(FULL).not.toMatch(/^sleep 5$/m);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 3 — systemd ExecStartPre uses 5Hz polling (was 1Hz)
// ═══════════════════════════════════════════════════════════════════════════

describe("systemd ExecStartPre — 5Hz readiness polling", () => {
  it("xdpyinfo wait uses sleep 0.2 with 300 iterations (60s budget at 5Hz)", () => {
    // Old: `for i in $(seq 1 60); do xdpyinfo ...; sleep 1; done`
    // New: `for i in $(seq 1 300); do xdpyinfo ...; sleep 0.2; done`
    // Same 60s total budget, 5x faster detection of X being ready.
    expect(SRC).toMatch(/seq 1 300\); do xdpyinfo[\s\S]{0,80}sleep 0\.2/);
    // The old 1Hz pattern must be gone in BOTH services
    expect(SRC).not.toMatch(/seq 1 60\); do xdpyinfo[\s\S]{0,80}sleep 1\b/);
  });

  it("noVNC port :5901 wait uses sleep 0.2 (was sleep 1)", () => {
    expect(SRC).toMatch(/seq 1 150\); do ss -tln \| grep -q :5901[\s\S]{0,80}sleep 0\.2/);
    // Old 30-iteration / 1Hz form must be gone
    expect(SRC).not.toMatch(/seq 1 30\); do ss -tln \| grep -q :5901[\s\S]{0,80}sleep 1\b/);
  });

  it("preserves the same total timeout budget (~60s for X, ~30s for port)", () => {
    // 300 × 0.2s = 60s for xdpyinfo
    // 150 × 0.2s = 30s for port :5901
    // Same wall-clock budget, faster detection. No regression in
    // tolerance for slow boots.
    const xdpy = SRC.match(/seq 1 (\d+)\); do xdpyinfo[\s\S]{0,80}sleep ([\d.]+)/);
    expect(xdpy).not.toBeNull();
    const xdpyTimeout = parseInt(xdpy![1], 10) * parseFloat(xdpy![2]);
    expect(xdpyTimeout).toBeGreaterThanOrEqual(60);

    const port = SRC.match(/seq 1 (\d+)\); do ss -tln \| grep -q :5901[\s\S]{0,80}sleep ([\d.]+)/);
    expect(port).not.toBeNull();
    const portTimeout = parseInt(port![1], 10) * parseFloat(port![2]);
    expect(portTimeout).toBeGreaterThanOrEqual(30);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 4 — Orchestrator polling intervals
// ═══════════════════════════════════════════════════════════════════════════

describe("ai-agent.service — decoupled from vncserver", () => {
  it("ai-agent.service no longer has After=/Wants=vncserver", () => {
    // Anchor on the AGENT_SVC_EOF heredoc body
    const m = SRC.match(
      /cat > \/etc\/systemd\/system\/ai-agent\.service << 'AGENT_SVC_EOF'([\s\S]*?)AGENT_SVC_EOF/
    );
    expect(m).not.toBeNull();
    const body = m![1];
    // Must NOT have vncserver as a hard dependency anymore
    expect(body).not.toMatch(/After=vncserver@:1\.service/);
    expect(body).not.toMatch(/Wants=vncserver@:1\.service/);
    // Must have a network-online dep so DNS works for the ipinfo geo call
    expect(body).toMatch(/After=network-online\.target/);
  });

  it("ai-agent.service no longer waits for xdpyinfo in ExecStartPre (X-readiness moves to lazy-init in agent)", () => {
    const m = SRC.match(
      /cat > \/etc\/systemd\/system\/ai-agent\.service << 'AGENT_SVC_EOF'([\s\S]*?)AGENT_SVC_EOF/
    );
    expect(m).not.toBeNull();
    const body = m![1];
    expect(body).not.toMatch(/xdpyinfo/);
  });

  it("ai-agent.service still creates XDG_RUNTIME_DIR in ExecStartPre (needed for DBUS even before X)", () => {
    const m = SRC.match(
      /cat > \/etc\/systemd\/system\/ai-agent\.service << 'AGENT_SVC_EOF'([\s\S]*?)AGENT_SVC_EOF/
    );
    expect(m![1]).toMatch(/runtime-ubuntu/);
  });
});

describe("Orchestrator — faster polling for IP + desktop readiness", () => {
  it("IP-assignment poll runs at 1.5s (was 5s) with same total budget", () => {
    expect(ROUTE_SRC).toMatch(/IP_POLL_MS\s*=\s*1500/);
    expect(ROUTE_SRC).toMatch(/IP_MAX_ATTEMPTS\s*=\s*80/);
    // Verify the budget didn't shrink: 80 × 1500ms = 120s ≥ old 24 × 5000ms = 120s
    const intervalMatch = ROUTE_SRC.match(/IP_POLL_MS\s*=\s*(\d+)/);
    const attemptsMatch = ROUTE_SRC.match(/IP_MAX_ATTEMPTS\s*=\s*(\d+)/);
    expect(intervalMatch).not.toBeNull();
    expect(attemptsMatch).not.toBeNull();
    const totalMs = parseInt(intervalMatch![1], 10) * parseInt(attemptsMatch![1], 10);
    expect(totalMs).toBeGreaterThanOrEqual(120_000);
  });

  it("desktop-readiness poll runs at 1.5s with ~7.5min total budget", () => {
    expect(ROUTE_SRC).toMatch(/DESKTOP_POLL_MS\s*=\s*1500/);
    expect(ROUTE_SRC).toMatch(/DESKTOP_MAX_ATTEMPTS\s*=\s*300/);
    const intervalMatch = ROUTE_SRC.match(/DESKTOP_POLL_MS\s*=\s*(\d+)/);
    const attemptsMatch = ROUTE_SRC.match(/DESKTOP_MAX_ATTEMPTS\s*=\s*(\d+)/);
    const totalMs = parseInt(intervalMatch![1], 10) * parseInt(attemptsMatch![1], 10);
    expect(totalMs).toBeGreaterThanOrEqual(7 * 60 * 1000); // ~7+ min budget preserved
  });

  it("does NOT have a 5000ms desktop poll left over (regression check)", () => {
    // Catch accidental reverts to the old 5s interval
    expect(ROUTE_SRC).not.toMatch(/}, 5000\);\s*\/\/.*desktop/i);
    // The interval values used should be 1500, not 5000
    expect(ROUTE_SRC).toMatch(/}, IP_POLL_MS\)/);
    expect(ROUTE_SRC).toMatch(/}, DESKTOP_POLL_MS\)/);
  });

  it("readiness probe targets agent port :8080 (not noVNC :6080) — agent comes up first", () => {
    // The probe URL inside the desktop-readiness check
    expect(ROUTE_SRC).toMatch(/`http:\/\/\$\{updatedMachine\.public_ip_address\}:8080\/`/);
    // Old :6080 probe must be gone from the readiness loop
    // (it may still appear in static port config — only flag the loop usage)
    const probeBlock = ROUTE_SRC.slice(
      ROUTE_SRC.indexOf("DESKTOP_POLL_MS"),
      ROUTE_SRC.indexOf("desktopCheckCount > DESKTOP_MAX_ATTEMPTS")
    );
    expect(probeBlock).not.toMatch(/:6080\//);
  });

  it("readiness probe accepts ANY HTTP response status (websockets server returns 426/400 to plain HTTP)", () => {
    // The agent is a WebSocket server — plain GET returns 426 Upgrade Required
    // or 400, NOT 200. We must accept anything that's a valid HTTP response.
    expect(ROUTE_SRC).toMatch(/res\.status > 0/);
  });
});
