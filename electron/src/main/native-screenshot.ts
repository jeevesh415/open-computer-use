/**
 * Native macOS screenshot using ScreenCaptureKit.
 *
 * Uses SCContentFilter(display:excludingApplications:) to capture the screen
 * while completely excluding Coasty's windows — the overlay never needs to
 * hide, so there's zero visual glitch.
 *
 * A small Swift helper is compiled on first use (takes ~2-3s), cached to disk
 * so subsequent app launches skip compilation. The binary runs as a child
 * process which inherits the parent app's Screen Recording TCC authorization.
 *
 * Requires macOS 14+ (SCScreenshotManager) and Xcode Command Line Tools.
 * Falls back gracefully — callers should check for null and use desktopCapturer.
 */

import { execFile } from 'child_process'
import { existsSync, writeFileSync, readFileSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'

// ── Swift source ────────────────────────────────────────────────────────

const SWIFT_SOURCE = `
import Foundation
import ScreenCaptureKit
import AppKit

// Arguments: <pid> <output-path> <width> <height> [quality] [displayId]
guard CommandLine.arguments.count >= 5,
      let pid = Int32(CommandLine.arguments[1]) else {
    fputs("Usage: screenshot-helper <pid> <output-path> <width> <height> [quality] [displayId]\\n", stderr)
    exit(1)
}

let outputPath = CommandLine.arguments[2]
let captureW = Int(CommandLine.arguments[3]) ?? 1920
let captureH = Int(CommandLine.arguments[4]) ?? 1080
let quality = CommandLine.arguments.count >= 6 ? Double(CommandLine.arguments[5]) ?? 0.7 : 0.7
// Optional display ID (CGDirectDisplayID) — 0 or omitted means primary
let requestedDisplayId: UInt32 = CommandLine.arguments.count >= 7 ? UInt32(CommandLine.arguments[6]) ?? 0 : 0

var exitCode: Int32 = 0
var done = false

if #available(macOS 14.0, *) {
    Task { @MainActor in
        defer {
            done = true
            CFRunLoopStop(CFRunLoopGetMain())
        }
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)

            // Select the requested display by CGDirectDisplayID.
            // Electron's Display.id matches SCDisplay.displayID on macOS.
            // If not found or 0, fall back to the first (primary) display.
            var display: SCDisplay?
            if requestedDisplayId != 0 {
                display = content.displays.first { $0.displayID == requestedDisplayId }
            }
            if display == nil {
                display = content.displays.first
            }
            guard let display = display else {
                fputs("No displays found\\n", stderr)
                exitCode = 1
                return
            }

            // Find our app by PID and exclude ALL its windows (overlay + rainbow border)
            let myApp = content.applications.first { $0.processID == pid }

            let filter: SCContentFilter
            if let app = myApp {
                filter = SCContentFilter(display: display, excludingApplications: [app], exceptingWindows: [])
            } else {
                // Couldn't find our app — capture everything (better than failing)
                filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
            }

            let config = SCStreamConfiguration()
            config.width = captureW
            config.height = captureH
            config.showsCursor = true

            let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)

            let rep = NSBitmapImageRep(cgImage: image)
            guard let jpegData = rep.representation(using: .jpeg, properties: [
                .compressionFactor: NSNumber(value: quality)
            ]) else {
                fputs("JPEG encoding failed\\n", stderr)
                exitCode = 1
                return
            }

            try jpegData.write(to: URL(fileURLWithPath: outputPath))

            // Print actual capture dimensions for the caller
            print("\\(image.width)x\\(image.height)")

        } catch {
            fputs("Error: \\(error.localizedDescription)\\n", stderr)
            exitCode = 1
        }
    }

    // Keep the main run loop alive for ScreenCaptureKit's async callbacks
    while !done {
        RunLoop.main.run(mode: .default, before: .distantFuture)
    }
} else {
    fputs("macOS 14+ required\\n", stderr)
    // Exit code 2 = unsupported OS — caller should stop retrying
    exitCode = 2
}

exit(exitCode)
`

// ── Compilation & caching ───────────────────────────────────────────────

const SOURCE_HASH = createHash('md5').update(SWIFT_SOURCE).digest('hex').slice(0, 8)
const CACHE_DIR = join(tmpdir(), 'coasty-native')
const BIN_NAME = `screenshot-helper-${SOURCE_HASH}`
const BIN_PATH = join(CACHE_DIR, BIN_NAME)
const SRC_PATH = join(CACHE_DIR, `${BIN_NAME}.swift`)

let compilePromise: Promise<string | null> | null = null

/**
 * Permanently failed — swiftc not installed or other unrecoverable error.
 * Once set, we never retry compilation for the rest of this app session.
 */
let compileFailed = false

/**
 * The native binary runs but the OS doesn't support it (macOS < 14).
 * Once detected, skip native capture entirely for this session.
 */
let nativeUnsupported = false

function compile(): Promise<string | null> {
  // Permanent failure — don't waste time retrying
  if (compileFailed) return Promise.resolve(null)

  if (compilePromise) return compilePromise

  compilePromise = new Promise((resolve) => {
    // Already compiled from a previous session? Verify binary still exists
    // (user or OS may have cleared /tmp since last run).
    if (existsSync(BIN_PATH)) {
      resolve(BIN_PATH)
      return
    }

    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true })
    }

    writeFileSync(SRC_PATH, SWIFT_SOURCE)

    execFile('swiftc', [
      SRC_PATH,
      '-o', BIN_PATH,
      '-framework', 'ScreenCaptureKit',
      '-framework', 'AppKit',
      '-O',                 // optimized build
      '-suppress-warnings', // avoid noisy deprecation warnings in output
    ], {
      timeout: 60000,
      // swiftc verbose output can easily exceed 1 MB on a clean rebuild
      // — see terminal.ts MAX_OUTPUT_BUFFER_BYTES for the 2026-05-17 fix.
      maxBuffer: 10 * 1024 * 1024,
    }, (error, _stdout, stderr) => {
      if (error) {
        console.warn('[NativeScreenshot] Compilation failed:', stderr || error.message)
        // Mark as permanently failed — no point retrying without swiftc
        compileFailed = true
        compilePromise = null
        resolve(null)
        return
      }
      console.log('[NativeScreenshot] Helper compiled successfully')
      resolve(BIN_PATH)
    })
  })

  return compilePromise
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Capture the screen using ScreenCaptureKit, excluding Coasty's windows.
 * Returns base64 JPEG string on success, null on failure (caller should
 * fall back to desktopCapturer).
 */
export async function captureScreenNative(
  width: number,
  height: number,
  quality = 0.7,
  displayId: number = 0,
): Promise<{ base64: string; resolution: string } | null> {
  // OS doesn't support SCScreenshotManager — stop wasting time
  if (nativeUnsupported) return null

  const binPath = await compile()
  if (!binPath) return null

  // Guard: binary may have been deleted since compilation (e.g. /tmp cleared).
  // Reset the compile promise so next call recompiles.
  if (!existsSync(binPath)) {
    compilePromise = null
    compileFailed = false // allow retry — binary was deleted, not a compile error
    return null
  }

  const outPath = join(CACHE_DIR, `screenshot-${Date.now()}.jpg`)

  return new Promise((resolve) => {
    execFile(binPath, [
      String(process.pid),
      outPath,
      String(width),
      String(height),
      String(quality),
      String(displayId),
    ], {
      timeout: 10000,
      // Screenshot binary writes the JPEG to disk; stdout is just the
      // "OK" status line. 10 MB cap is the project-wide standard set on
      // 2026-05-17 — see terminal.ts MAX_OUTPUT_BUFFER_BYTES.
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        // Exit code 2 = macOS < 14, won't ever work — stop retrying
        if ((error as any).code === 2 || stderr?.includes('macOS 14+ required')) {
          console.warn('[NativeScreenshot] macOS 14+ required — disabling native capture')
          nativeUnsupported = true
        } else {
          console.warn('[NativeScreenshot] Capture failed:', stderr || error.message)
        }
        resolve(null)
        return
      }

      try {
        const jpegBuffer = readFileSync(outPath)
        const base64 = jpegBuffer.toString('base64')
        const resolution = stdout.trim() || `${width}x${height}`

        // Clean up temp file (best-effort, non-blocking)
        try { unlinkSync(outPath) } catch { /* ignore */ }

        resolve({ base64, resolution })
      } catch (e: any) {
        console.warn('[NativeScreenshot] Read failed:', e.message)
        resolve(null)
      }
    })
  })
}

/**
 * Start compiling the Swift helper in the background so it's ready
 * by the time the first screenshot is needed. Call during app startup.
 */
export function warmupNativeScreenshot(): void {
  if (process.platform !== 'darwin') return
  compile().catch(() => {})
}
