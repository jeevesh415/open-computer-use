import { BrowserWindow, screen } from 'electron'
import { contentProtectionReliable } from './window-manager'
import { getActiveDisplay } from './display-manager'

let borderWindow: BrowserWindow | null = null
let visible = false
let loaded: Promise<void> = Promise.resolve()
// 'full' = task-running intensity, 'ambient' = lighter expanded-overlay glow
let currentIntensity: 'full' | 'ambient' = 'full'

export function initRainbowBorder(): void {
  if (borderWindow && !borderWindow.isDestroyed()) return
  createWindow()
}

/** Show at full intensity (task running). */
export async function showRainbowBorder(): Promise<void> {
  currentIntensity = 'full'
  await showWithIntensity('full')
}

/** Show a lighter ambient glow (overlay expanded). */
export async function showAmbientRainbow(): Promise<void> {
  // Don't downgrade if a task is already running at full intensity
  if (visible && currentIntensity === 'full') return
  currentIntensity = 'ambient'
  await showWithIntensity('ambient')
}

async function showWithIntensity(intensity: 'full' | 'ambient'): Promise<void> {
  if (!borderWindow || borderWindow.isDestroyed()) {
    createWindow()
  }
  await loaded

  const win = borderWindow!
  if (win.isDestroyed()) return

  const { x, y, width, height } = getActiveDisplay().bounds
  win.setBounds({ x, y, width, height })

  // Set intensity before fading in (or update if already visible)
  const opacityVal = intensity === 'ambient' ? 0.15 : 1.0
  win.webContents.executeJavaScript(`setIntensity(${JSON.stringify(opacityVal)})`).catch(() => {})

  if (!visible) {
    visible = true
    win.showInactive()
    win.setAlwaysOnTop(true, 'screen-saver', 0)
    win.webContents.executeJavaScript('fadeIn()').catch(() => {})
  }
}

export function hideRainbowBorder(): void {
  if (!visible) return
  visible = false
  currentIntensity = 'full'

  if (!borderWindow || borderWindow.isDestroyed()) return
  borderWindow.hide()
}

/** Hide only the ambient glow (when collapsing overlay). Does nothing if a task is running. */
export function hideAmbientRainbow(): void {
  if (!visible || currentIntensity === 'full') return
  visible = false
  currentIntensity = 'full'

  if (!borderWindow || borderWindow.isDestroyed()) return
  borderWindow.hide()
}

/** Hide for screenshot — instant opacity snap to 0 (must not appear in capture). */
export function hideRainbowForScreenshot(): void {
  if (!borderWindow || borderWindow.isDestroyed() || !borderWindow.isVisible()) return
  borderWindow.setOpacity(0)
}

/** Restore after screenshot with a smooth fade-in via native opacity. */
export function showRainbowAfterScreenshot(): void {
  if (!visible || !borderWindow || borderWindow.isDestroyed()) return
  // Re-assert z-order — may have been lost while invisible
  borderWindow.setAlwaysOnTop(true, 'screen-saver', 0)

  // Smooth fade from 0 → 1 over 300ms (ease-out cubic)
  const win = borderWindow
  const DURATION = 300
  const STEP = 16 // ~60fps
  const steps = Math.ceil(DURATION / STEP)
  let step = 0
  const timer = setInterval(() => {
    step++
    if (!win || win.isDestroyed()) { clearInterval(timer); return }
    const t = Math.min(step / steps, 1)
    const eased = 1 - Math.pow(1 - t, 3) // ease-out cubic
    win.setOpacity(eased)
    if (t >= 1) clearInterval(timer)
  }, STEP)
}

/** Reposition the rainbow border to cover a different display. */
export function moveRainbowToDisplay(display: Electron.Display): void {
  if (!borderWindow || borderWindow.isDestroyed()) return
  const { x, y, width, height } = display.bounds
  borderWindow.setBounds({ x, y, width, height })
}

export function destroyRainbowBorder(): void {
  if (borderWindow && !borderWindow.isDestroyed()) {
    borderWindow.destroy()
  }
  borderWindow = null
  visible = false
  loaded = Promise.resolve()
}

function createWindow(): void {
  const { x, y, width, height } = getActiveDisplay().bounds

  borderWindow = new BrowserWindow({
    x, y, width, height,
    frame: false,
    transparent: true,
    thickFrame: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    roundedCorners: false,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // Use 'floating' level — above normal apps but below the main overlay ('screen-saver').
  borderWindow.setAlwaysOnTop(true, 'screen-saver', 0)
  borderWindow.setIgnoreMouseEvents(true)

  // On Windows 10 2004+, exclude the rainbow border from screen capture so it
  // doesn't appear in screenshots — same mechanism as the main overlay window.
  // Gated on the same version check to avoid WDA_MONITOR black-box on older Windows.
  if (contentProtectionReliable) {
    borderWindow.setContentProtection(true)
  }

  if (process.platform !== 'win32') {
    borderWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  loaded = new Promise<void>((resolve) => {
    borderWindow!.once('ready-to-show', () => resolve())
  })

  borderWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(GLOW_HTML)}`)

  borderWindow.on('closed', () => {
    borderWindow = null
    visible = false
    loaded = Promise.resolve()
  })
}

// ── HTML / Canvas ──────────────────────────────────────────────────
//
// Organic rainbow aura using canvas with soft radial-gradient blobs
// that orbit the screen perimeter at different speeds and directions.
//
// Key techniques:
//  - 14 blobs with independent speed, direction, wobble, pulse, and hue
//  - Additive blending ('lighter') for rich aurora-like color mixing
//  - Half-resolution canvas → browser upscale = free natural softness
//  - Blob centers placed slightly outside the viewport so glow bleeds inward
//  - Subtle global "breathing" (±10% intensity oscillation)
//  - Some blobs clockwise, some counter-clockwise → crossing patterns
//  - Varied radii (120–350px) for depth: large faint wash + small bright accents
//
const GLOW_HTML = `<!DOCTYPE html>
<html>
<head>
<style>
  *{margin:0;padding:0}
  html,body{width:100vw;height:100vh;overflow:hidden;background:transparent}
  #wrap{position:fixed;inset:0;opacity:0;transition:opacity .6s ease-out}
  #wrap.on{opacity:1}
  canvas{width:100vw;height:100vh;display:block}
</style>
</head>
<body>
<div id="wrap"><canvas id="c"></canvas></div>
<script>
(function(){
  var wrap = document.getElementById('wrap');
  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');

  // Render at half resolution — upscale gives free softness
  var W, H;
  function resize() {
    W = Math.ceil(window.innerWidth / 2);
    H = Math.ceil(window.innerHeight / 2);
    canvas.width = W;
    canvas.height = H;
  }
  resize();
  window.addEventListener('resize', resize);

  // Deterministic pseudo-random per blob index
  function sr(i) {
    return ((Math.sin(i * 127.1 + 311.7) * 43758.5453) % 1 + 1) % 1;
  }

  var NUM = 18;
  var blobs = [];
  for (var i = 0; i < NUM; i++) {
    var r1 = sr(i), r2 = sr(i+97), r3 = sr(i+199), r4 = sr(i+307);
    blobs.push({
      baseT: i / NUM,
      // Different speeds, some clockwise (positive) some counter-clockwise
      speed: (0.012 + r1 * 0.022) * (r2 > 0.5 ? 1 : -1),
      wobbleAmp: 0.008 + r3 * 0.025,
      wobbleFreq: 0.25 + r4 * 0.55,
      // Larger radii for wider, more visible glow
      radius: (100 + r1 * 160),  // in half-res pixels (200-520 in screen px)
      pulseFreq: 0.25 + r2 * 0.6,
      pulseAmp: 0.18 + r3 * 0.14,
      alpha: 0.18 + r4 * 0.24,
      hueBase: (i / NUM) * 360,
      // Per-blob hue drift speed so colors diverge over time
      hueDrift: 4 + r2 * 18,  // 4–22 deg/sec (was fixed 6)
      // Secondary hue offset that oscillates — creates color shimmer
      hueOscAmp: 20 + r3 * 40,  // ±20–60 deg swing
      hueOscFreq: 0.15 + r4 * 0.35,
    });
  }

  // Convert perimeter parameter t ∈ [0,1] to (x,y) in half-res coords.
  // Offset pushes blob center outside the viewport edge.
  var OFFSET = 30; // half-res pixels (60 screen px) — pushes glow further inward
  function perimPt(t) {
    t = ((t % 1) + 1) % 1;
    var P = 2 * (W + H);
    var d = t * P;
    if (d < W)          return { x: d,               y: -OFFSET };
    if (d < W + H)      return { x: W + OFFSET,      y: d - W };
    if (d < 2 * W + H)  return { x: W - (d - W - H), y: H + OFFSET };
    return                      { x: -OFFSET,          y: H - (d - 2*W - H) };
  }

  // Global intensity multiplier (1.0 = full task mode, 0.35 = ambient overlay glow)
  var intensity = 1.0;
  window.setIntensity = function(v) { intensity = v; };

  var running = false;
  var lastTs = 0;

  function frame(ts) {
    if (!running) return;
    var time = ts / 1000;

    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';

    // Breathing: global intensity oscillation
    var breathe = 0.78 + 0.22 * Math.sin(time * 1.1);

    for (var i = 0; i < NUM; i++) {
      var b = blobs[i];
      var t = b.baseT + b.speed * time
            + Math.sin(time * b.wobbleFreq) * b.wobbleAmp
            + Math.sin(time * b.wobbleFreq * 0.7 + 2.0) * b.wobbleAmp * 0.5;
      var p = perimPt(t);
      var r = b.radius * (1 + b.pulseAmp * Math.sin(time * b.pulseFreq));

      // Per-blob hue: base + individual drift + oscillating shimmer
      var hue = (b.hueBase + time * b.hueDrift
                + Math.sin(time * b.hueOscFreq) * b.hueOscAmp) % 360;
      if (hue < 0) hue += 360;
      // Secondary hue for gradient edge — shifted 30–60° for richer color transitions
      var hue2 = (hue + 30 + r * 0.15) % 360;
      var a = b.alpha * breathe * intensity;

      var grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grad.addColorStop(0,   'hsla(' + hue + ',92%,67%,' + (a).toFixed(3) + ')');
      grad.addColorStop(0.2, 'hsla(' + hue + ',88%,62%,' + (a * 0.8).toFixed(3) + ')');
      grad.addColorStop(0.45,'hsla(' + hue2 + ',82%,57%,' + (a * 0.4).toFixed(3) + ')');
      grad.addColorStop(0.75,'hsla(' + hue2 + ',74%,52%,' + (a * 0.12).toFixed(3) + ')');
      grad.addColorStop(1,   'hsla(' + hue2 + ',65%,48%,0)');

      ctx.fillStyle = grad;
      // Only fill the region this blob covers (perf optimisation)
      ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    }

    requestAnimationFrame(frame);
  }

  window.fadeIn = function() {
    wrap.classList.add('on');
    if (!running) {
      running = true;
      requestAnimationFrame(frame);
    }
  };
  window.fadeOut = function() {
    wrap.classList.remove('on');
    setTimeout(function() {
      if (!wrap.classList.contains('on')) running = false;
    }, 500);
  };
})();
</script>
</body>
</html>`
