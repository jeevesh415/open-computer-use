/**
 * Manages multi-display selection for screenshot capture.
 *
 * Exposes:
 * - getDisplayList()  — returns all connected displays with metadata
 * - getActiveDisplayId() / setActiveDisplayId() — persisted selection
 * - getActiveDisplay() — resolved Display object for the active selection
 *
 * The display ID from Electron's screen.getAllDisplays() matches:
 * - macOS: CGDirectDisplayID (same as SCDisplay.displayID)
 * - Windows: HMONITOR-derived ID (matches desktopCapturer source.display_id on 19041+)
 * - Linux: X11 output ID (matches source.display_id on Electron 24+)
 */

import { screen } from 'electron'

export interface DisplayInfo {
  id: number
  name: string
  width: number
  height: number
  isPrimary: boolean
  scaleFactor: number
  bounds: { x: number; y: number; width: number; height: number }
}

/** Currently selected display ID. null = primary display (default). */
let activeDisplayId: number | null = null

/** Build a user-friendly display list from Electron's screen API. */
export function getDisplayList(): DisplayInfo[] {
  const displays = screen.getAllDisplays()
  const primary = screen.getPrimaryDisplay()

  return displays.map((d, idx) => ({
    id: d.id,
    name: d.id === primary.id
      ? `Main Display`
      : `Display ${idx + 1}`,
    width: d.size.width,
    height: d.size.height,
    isPrimary: d.id === primary.id,
    scaleFactor: d.scaleFactor,
    bounds: d.bounds,
  }))
}

/** Get the currently selected display ID. null means primary. */
export function getActiveDisplayId(): number | null {
  return activeDisplayId
}

/** Set the active display for screenshot capture. null = primary. */
export function setActiveDisplayId(id: number | null): void {
  // Validate the ID exists (or null for primary)
  if (id !== null) {
    const exists = screen.getAllDisplays().some((d) => d.id === id)
    if (!exists) {
      console.warn(`[DisplayManager] Display ${id} not found, falling back to primary`)
      id = null
    }
  }
  activeDisplayId = id
}

/**
 * Get the resolved Electron Display object for the active selection.
 * Falls back to primary if the selected display was disconnected.
 */
export function getActiveDisplay(): Electron.Display {
  if (activeDisplayId !== null) {
    const match = screen.getAllDisplays().find((d) => d.id === activeDisplayId)
    if (match) return match
    // Display disconnected — fall back to primary
    console.warn(`[DisplayManager] Display ${activeDisplayId} disconnected, using primary`)
    activeDisplayId = null
  }
  return screen.getPrimaryDisplay()
}
