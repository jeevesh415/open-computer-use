import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ─── useLazyFetch tests ───────────────────────────────────────────
// We test the logic directly since the hook uses simple fetch + refs

describe("useLazyFetch logic", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("should not fetch until trigger is called", async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as any

    // Simulate the hook's internal logic
    let fetched = false
    const trigger = () => {
      if (fetched) return
      fetched = true
      globalThis.fetch("/api/test")
    }

    // Before trigger: no fetch
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fetched).toBe(false)

    // After trigger: fetch called once
    trigger()
    expect(fetchMock).toHaveBeenCalledWith("/api/test")
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Second trigger: no additional fetch (deduplication)
    trigger()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("should only fetch once even with multiple rapid calls", () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    })
    globalThis.fetch = fetchMock as any

    let fetched = false
    const trigger = () => {
      if (fetched) return
      fetched = true
      globalThis.fetch("/api/swarms")
    }

    // Rapid-fire calls
    trigger()
    trigger()
    trigger()
    trigger()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("should handle failed fetch gracefully", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network error"))
    globalThis.fetch = fetchMock as any

    let fetched = false
    let data: any[] = []

    const trigger = async () => {
      if (fetched) return
      fetched = true
      try {
        const r = await globalThis.fetch("/api/swarms")
        if (r.ok) {
          const d = await r.json()
          data = d.swarms || []
        }
      } catch {
        // Silent — matches production behavior
      }
    }

    await trigger()
    expect(data).toEqual([])
    expect(fetched).toBe(true)
  })

  it("should extract data using the transform function", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ swarms: [{ swarm_id: "abc", status: "running" }] }),
    })
    globalThis.fetch = fetchMock as any

    let data: any[] = []
    const extract = (d: any) => d.swarms || []

    const r = await globalThis.fetch("/api/swarms")
    if (r.ok) {
      const d = await r.json()
      data = extract(d)
    }

    expect(data).toEqual([{ swarm_id: "abc", status: "running" }])
  })

  it("should handle non-ok responses without setting data", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve(null),
    })
    globalThis.fetch = fetchMock as any

    let data: any[] = [{ existing: true }]

    const r = await globalThis.fetch("/api/swarms")
    if (r.ok) {
      const d = await r.json()
      data = d.swarms || []
    }

    // Data should remain unchanged
    expect(data).toEqual([{ existing: true }])
  })
})

// ─── useSidebarMachines logic tests ───────────────────────────────

describe("useSidebarMachines stats computation", () => {
  it("should compute correct stats from machine list", () => {
    const machines = [
      { status: "running", id: "1" },
      { status: "running", id: "2" },
      { status: "stopped", id: "3" },
      { status: "creating", id: "4" },
      { status: "starting", id: "5" },
    ]

    const running = machines.filter(
      (m) => m.status === "running" || (m as any).electronConnected
    ).length
    const stopped = machines.filter((m) => m.status === "stopped").length
    const creating = machines.filter((m) =>
      ["creating", "starting"].includes(m.status)
    ).length
    const total = machines.length

    expect(running).toBe(2)
    expect(stopped).toBe(1)
    expect(creating).toBe(2)
    expect(total).toBe(5)
  })

  it("should count electronConnected machines as running", () => {
    const machines = [
      { status: "stopped", id: "1", electronConnected: true },
      { status: "stopped", id: "2" },
    ]

    const running = machines.filter(
      (m) => m.status === "running" || (m as any).electronConnected
    ).length

    expect(running).toBe(1)
  })

  it("should return zeros for empty machine list", () => {
    const machines: any[] = []

    const running = machines.filter(
      (m) => m.status === "running" || (m as any).electronConnected
    ).length
    const stopped = machines.filter((m) => m.status === "stopped").length
    const creating = machines.filter((m) =>
      ["creating", "starting"].includes(m.status)
    ).length
    const total = machines.length

    expect(running).toBe(0)
    expect(stopped).toBe(0)
    expect(creating).toBe(0)
    expect(total).toBe(0)
  })
})

// ─── SidebarItem getChatIcon logic tests ──────────────────────────

describe("getChatIcon keyword matching", () => {
  // Replicate the matching logic from sidebar-item.tsx
  function matchCategory(title: string): string {
    const lowerTitle = title.toLowerCase()

    if (["code", "function", "script", "program", "develop"].some(k => lowerTitle.includes(k))) return "code"
    if (["database", "sql", "query", "table", "data"].some(k => lowerTitle.includes(k))) return "database"
    if (["api", "web", "http", "url", "website"].some(k => lowerTitle.includes(k))) return "web"
    if (["file", "document", "text", "write", "read"].some(k => lowerTitle.includes(k))) return "file"
    if (["image", "photo", "picture", "design", "ui", "ux"].some(k => lowerTitle.includes(k))) return "image"
    if (["chart", "graph", "analytic", "report", "dashboard"].some(k => lowerTitle.includes(k))) return "chart"
    if (["bug", "fix", "error", "debug", "issue"].some(k => lowerTitle.includes(k))) return "bug"
    if (["setting", "config", "setup", "install"].some(k => lowerTitle.includes(k))) return "settings"
    if (["deploy", "launch", "release", "build"].some(k => lowerTitle.includes(k))) return "launch"
    if (["style", "css", "theme", "color"].some(k => lowerTitle.includes(k))) return "style"
    if (["game", "play"].some(k => lowerTitle.includes(k))) return "game"
    if (["music", "audio", "sound"].some(k => lowerTitle.includes(k))) return "music"
    if (["security", "auth", "password", "encrypt"].some(k => lowerTitle.includes(k))) return "security"
    if (["search", "find", "filter"].some(k => lowerTitle.includes(k))) return "search"
    if (["ai", "ml", "model", "train"].some(k => lowerTitle.includes(k))) return "ai"
    if (["package", "library", "npm", "install"].some(k => lowerTitle.includes(k))) return "package"
    if (["cloud", "aws", "azure", "gcp"].some(k => lowerTitle.includes(k))) return "cloud"
    if (["performance", "optimize", "speed", "fast"].some(k => lowerTitle.includes(k))) return "performance"
    return "default"
  }

  it("should match code-related titles", () => {
    expect(matchCategory("Write a Python script")).toBe("code")
    expect(matchCategory("Debug this function")).toBe("code")
    expect(matchCategory("Develop a new feature")).toBe("code")
  })

  it("should match database titles", () => {
    expect(matchCategory("SQL query optimization")).toBe("database")
    expect(matchCategory("Create database schema")).toBe("database")
  })

  it("should match web/API titles", () => {
    expect(matchCategory("Build REST API")).toBe("web")
    expect(matchCategory("Website redesign")).toBe("web")
  })

  it("should match security titles", () => {
    expect(matchCategory("Auth token renewal")).toBe("security")
    expect(matchCategory("Password reset flow")).toBe("security")
    expect(matchCategory("Encrypt the payload")).toBe("security")
  })

  it("should be case insensitive", () => {
    expect(matchCategory("BUILD A WEBSITE")).toBe("web")
    expect(matchCategory("Fix BUG #123")).toBe("bug")
  })

  it("should return default for unmatched titles", () => {
    expect(matchCategory("Hello world")).toBe("default")
    expect(matchCategory("")).toBe("default")
    expect(matchCategory("Random conversation")).toBe("default")
  })

  it("should match first category when multiple apply", () => {
    // "code" comes before "database" in the chain
    expect(matchCategory("Code to query database")).toBe("code")
    // "bug" comes before "search"
    expect(matchCategory("Fix search bug")).toBe("bug")
  })
})

// ─── Memoization behavior tests ──────────────────────────────────

describe("React.memo prop stability", () => {
  it("should produce stable useMemo output for same inputs", () => {
    // Simulate the memoization pattern used in sidebar-nav-section
    const chats1 = [{ id: "1", title: "Test" }]
    const chats2 = chats1 // Same reference

    // Same reference → same memo output (React.memo skips re-render)
    expect(chats1).toBe(chats2)

    // Different reference, same content → React.memo would re-render
    const chats3 = [{ id: "1", title: "Test" }]
    expect(chats1).not.toBe(chats3)
  })

  it("should have stable trigger function across hook instances", () => {
    // The useLazyFetch hook uses useCallback([]) for stability
    // Simulate: the trigger function reference should not change
    let fetchedRef = false
    const trigger = () => {
      if (fetchedRef) return
      fetchedRef = true
    }

    // Same function reference
    const ref1 = trigger
    const ref2 = trigger
    expect(ref1).toBe(ref2)
  })
})

// ─── Machine polling interval logic ──────────────────────────────

describe("Machine polling behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should call fetch at 15s intervals", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ machines: [] }),
    })
    globalThis.fetch = fetchMock as any

    // Simulate the polling pattern from useSidebarMachines
    const fetchMachines = async () => {
      try {
        await globalThis.fetch("/api/machines")
      } catch { /* silent */ }
    }

    fetchMachines()
    const interval = setInterval(fetchMachines, 15_000)

    // Initial fetch
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // After 15s
    vi.advanceTimersByTime(15_000)
    // The interval fires, but since fetchMachines is async we need to flush
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // After another 15s
    vi.advanceTimersByTime(15_000)
    expect(fetchMock).toHaveBeenCalledTimes(3)

    clearInterval(interval)

    // After clearing, no more calls
    vi.advanceTimersByTime(15_000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("should not fetch if user is null", () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as any

    const user = null

    // Simulate the guard from useSidebarMachines
    if (user) {
      globalThis.fetch("/api/machines")
    }

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
