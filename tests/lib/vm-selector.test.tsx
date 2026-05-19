// @vitest-environment jsdom
/**
 * VM selector tests — focus on:
 *
 *   1. Section-header copy is correct (regression guard against the
 *      "Linux desktops on Coasty" mistake; cloud machines aren't only
 *      Linux on Coasty).
 *   2. Section headers always render when a section has machines, even if
 *      the other section is empty.
 *   3. Cloud machines show under the "Cloud" section, electron machines
 *      under "Your Computers" — never crossed.
 *   4. The offline hint card appears only when every local machine is
 *      offline.
 *   5. The popover content has a viewport-bounded max-height so it always
 *      fits on screen, no matter how many VMs the user has.
 *
 * Heavy peripheral deps (motion/react, phosphor icons, the create-machine
 * dialog, account-dialog-store) are mocked — none of them affect the copy
 * or layout invariants under test.
 */
import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"

// ---------------------------------------------------------------------------
// Mocks for heavy peripheral deps
// ---------------------------------------------------------------------------

vi.mock("motion/react", () => {
  const motion: any = new Proxy(
    {},
    {
      get:
        (_: any, tag: string) =>
        ({ children, ...props }: any) => {
          // Strip motion-only props so React doesn't warn about unknown
          // attributes. Anything that smells like a motion prop gets dropped.
          const motionPropPattern = /^(initial|animate|exit|transition|whileHover|whileTap|whileInView|whileFocus|whileDrag|layoutId|layout|drag|variants|custom|onAnimation|onLayout)/
          const cleaned: Record<string, any> = {}
          for (const k of Object.keys(props)) {
            if (!motionPropPattern.test(k)) cleaned[k] = props[k]
          }
          const el = tag === "default" ? "div" : tag
          return React.createElement(el, cleaned, children)
        },
    }
  )
  return {
    motion,
    AnimatePresence: ({ children }: any) => children,
    LayoutGroup: ({ children }: any) => children,
  }
})

vi.mock("@phosphor-icons/react", () => {
  const Icon = (props: any) =>
    React.createElement("span", { "data-icon": "phosphor", ...props })
  // vitest validates named exports against the real module shape, so each
  // icon used by vm-selector.tsx must be enumerated.
  return {
    CircleNotch: Icon,
    Plus: Icon,
    Desktop: Icon,
    Laptop: Icon,
    WifiHigh: Icon,
    WifiSlash: Icon,
    Check: Icon,
    GitFork: Icon,
    Lock: Icon,
    Lightning: Icon,
    ArrowRight: Icon,
    Minus: Icon,
    CaretUpDown: Icon,
    CaretRight: Icon,
    Cloud: Icon,
    House: Icon,
    default: Icon,
  }
})

vi.mock("@/lib/account-dialog-store", () => ({
  useAccountDialog: { getState: () => ({ open: vi.fn() }) },
}))

vi.mock("@/app/components/machines/create-machine-dialog", () => ({
  CreateMachineDialog: () => null,
}))

// Stub the icon imports so we don't pull real SVGs into the test runner.
vi.mock("@/components/icons/cloud-desktop", () => ({
  CloudDesktopIcon: (props: any) =>
    React.createElement("span", { "data-icon": "cloud-desktop", ...props }),
}))

vi.mock("@/components/icons/local-laptop", () => ({
  LocalLaptopIcon: (props: any) =>
    React.createElement("span", { "data-icon": "local-laptop", ...props }),
}))

vi.mock("@/components/icons/platform-icons", () => {
  const make = (label: string) => (props: any) =>
    React.createElement("span", { "data-platform": label, ...props })
  return {
    WindowsIcon: make("win"),
    AppleIcon: make("mac"),
    LinuxIcon: make("linux"),
  }
})

// ---------------------------------------------------------------------------
// System under test (imports must come AFTER mocks)
// ---------------------------------------------------------------------------
import { SectionHeader, ComputersBody } from "@/components/common/vm-selector/vm-selector"
import type { UserMachine } from "@/types/machines.types"

// Minimal builder for the bits of UserMachine the body actually reads.
function machine(over: Partial<UserMachine> & { id: string; displayName: string }): UserMachine {
  return {
    status: "running",
    publicIpAddress: "1.2.3.4",
    websocketPort: 6080,
    vncPassword: "secretpw",
    settings: { provider: "aws", platform: "linux", osType: "linux" },
    ...over,
  } as UserMachine
}

const noopDisplayStatus = (m: UserMachine) =>
  // For the Electron path we want "offline" so the hint shows.
  m.settings?.provider === "electron" ? "offline" : (m.status as any)

afterEach(() => {
  cleanup()
})

// ---------------------------------------------------------------------------
// 1. Section header copy
// ---------------------------------------------------------------------------

describe("SectionHeader copy", () => {
  it("cloud variant uses provider-neutral subtitle (NOT 'Linux desktops')", () => {
    const { container } = render(
      <SectionHeader variant="cloud" title="Cloud" subtitle="Hosted by Coasty" />
    )
    const text = container.textContent || ""
    expect(text).toContain("Cloud")
    expect(text).toContain("Hosted by Coasty")
    expect(text).not.toMatch(/linux desktop/i)
  })

  it("local variant says it's via the desktop app", () => {
    const { container } = render(
      <SectionHeader
        variant="local"
        title="Your Computers"
        subtitle="Connected via the desktop app"
      />
    )
    const text = container.textContent || ""
    expect(text).toContain("Your Computers")
    expect(text).toContain("Connected via the desktop app")
  })

  it("uses neutral muted colors (no bright tile background)", () => {
    const { container } = render(
      <SectionHeader variant="cloud" title="Cloud" subtitle="Hosted by Coasty" />
    )
    const html = container.innerHTML
    // Make sure we never re-introduce the colored-tile look.
    expect(html).not.toMatch(/bg-blue-500/)
    expect(html).not.toMatch(/bg-emerald-500/)
    expect(html).toMatch(/text-muted-foreground/)
  })
})

// ---------------------------------------------------------------------------
// 2. Headers always render, regardless of section count
// ---------------------------------------------------------------------------

describe("ComputersBody section headers", () => {
  const baseProps = {
    selectedVMId: null as string | null,
    handleSelect: vi.fn(),
    getDisplayStatus: noopDisplayStatus,
    isLoading: false,
  }

  it("renders the Cloud header even when there are no local machines", () => {
    render(
      <ComputersBody
        {...baseProps}
        cloudMachines={[machine({ id: "c1", displayName: "alpha" })]}
        electronMachines={[]}
        hasAnyMachines
      />
    )
    expect(screen.getByText("Cloud")).toBeInTheDocument()
    expect(screen.getByText("Hosted by Coasty")).toBeInTheDocument()
    // Local section should NOT appear when there are no local machines.
    expect(screen.queryByText("Your Computers")).not.toBeInTheDocument()
  })

  it("renders the Your Computers header even when there are no cloud machines", () => {
    render(
      <ComputersBody
        {...baseProps}
        cloudMachines={[]}
        electronMachines={[
          machine({
            id: "e1",
            displayName: "prate-mbp",
            settings: { provider: "electron", platform: "darwin" },
          }),
        ]}
        hasAnyMachines
      />
    )
    expect(screen.getByText("Your Computers")).toBeInTheDocument()
    expect(screen.getByText("Connected via the desktop app")).toBeInTheDocument()
    expect(screen.queryByText("Cloud")).not.toBeInTheDocument()
  })

  it("renders both headers when both sections have machines", () => {
    render(
      <ComputersBody
        {...baseProps}
        cloudMachines={[machine({ id: "c1", displayName: "alpha" })]}
        electronMachines={[
          machine({
            id: "e1",
            displayName: "prate-mbp",
            settings: { provider: "electron", platform: "darwin" },
          }),
        ]}
        hasAnyMachines
      />
    )
    expect(screen.getByText("Cloud")).toBeInTheDocument()
    expect(screen.getByText("Your Computers")).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 3. Machines land under the correct section
// ---------------------------------------------------------------------------

describe("ComputersBody machine placement", () => {
  it("never shows 'Linux desktops on Coasty' anywhere — provider-neutral copy", () => {
    const { container } = render(
      <ComputersBody
        cloudMachines={[machine({ id: "c1", displayName: "alpha" })]}
        electronMachines={[
          machine({
            id: "e1",
            displayName: "prate-mbp",
            settings: { provider: "electron", platform: "darwin" },
          }),
        ]}
        selectedVMId={null}
        handleSelect={vi.fn()}
        getDisplayStatus={noopDisplayStatus}
        hasAnyMachines
        isLoading={false}
      />
    )
    expect(container.textContent).not.toMatch(/linux desktop/i)
  })

  it("shows the empty state when no machines exist", () => {
    render(
      <ComputersBody
        cloudMachines={[]}
        electronMachines={[]}
        selectedVMId={null}
        handleSelect={vi.fn()}
        getDisplayStatus={noopDisplayStatus}
        hasAnyMachines={false}
        isLoading={false}
      />
    )
    expect(screen.getByText("No computers yet")).toBeInTheDocument()
    expect(
      screen.getByText(/Spin up a cloud machine|install the desktop app/i)
    ).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 4. Offline hint visibility
// ---------------------------------------------------------------------------

describe("Offline desktop-app hint", () => {
  const props = {
    cloudMachines: [],
    selectedVMId: null as string | null,
    handleSelect: vi.fn(),
    isLoading: false,
  }

  it("shows when ALL local machines are offline", () => {
    render(
      <ComputersBody
        {...props}
        electronMachines={[
          machine({
            id: "e1",
            displayName: "prate-mbp",
            settings: { provider: "electron", platform: "darwin" },
          }),
          machine({
            id: "e2",
            displayName: "prate-pc",
            settings: { provider: "electron", platform: "win32" },
          }),
        ]}
        // All electron machines report "offline" via our stub.
        getDisplayStatus={() => "offline" as any}
        hasAnyMachines
      />
    )
    expect(
      screen.getByText(/Launch the Coasty desktop app on a device/i)
    ).toBeInTheDocument()
  })

  it("hides when at least one local machine is online", () => {
    render(
      <ComputersBody
        {...props}
        electronMachines={[
          machine({
            id: "e1",
            displayName: "prate-mbp",
            settings: { provider: "electron", platform: "darwin" },
          }),
          machine({
            id: "e2",
            displayName: "prate-pc",
            settings: { provider: "electron", platform: "win32" },
          }),
        ]}
        getDisplayStatus={(m) =>
          (m.id === "e1" ? "online" : "offline") as any
        }
        hasAnyMachines
      />
    )
    expect(
      screen.queryByText(/Launch the Coasty desktop app on a device/i)
    ).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 4b. OS subtitle — every row, every platform, sleek single line
// ---------------------------------------------------------------------------

describe("OS subtitle on machine rows", () => {
  const baseProps = {
    selectedVMId: null as string | null,
    handleSelect: vi.fn(),
    getDisplayStatus: noopDisplayStatus,
    isLoading: false,
    hasAnyMachines: true,
  }

  it("shows the OS name on cloud rows (not just on locals)", () => {
    render(
      <ComputersBody
        {...baseProps}
        cloudMachines={[
          machine({
            id: "c1",
            displayName: "alpha",
            settings: { provider: "aws", platform: "linux", osType: "linux" },
          }),
        ]}
        electronMachines={[]}
      />
    )
    expect(screen.getByText("Linux")).toBeInTheDocument()
  })

  it("uses 'macOS' (not 'Mac') for darwin local computers", () => {
    render(
      <ComputersBody
        {...baseProps}
        cloudMachines={[]}
        electronMachines={[
          machine({
            id: "e1",
            displayName: "prate-mbp",
            settings: { provider: "electron", platform: "darwin" },
          }),
        ]}
      />
    )
    expect(screen.getByText("macOS")).toBeInTheDocument()
    expect(screen.queryByText("Mac", { exact: true })).not.toBeInTheDocument()
  })

  it("uses 'Windows' (not 'Win') for win32 local computers", () => {
    render(
      <ComputersBody
        {...baseProps}
        cloudMachines={[]}
        electronMachines={[
          machine({
            id: "e1",
            displayName: "prate-pc",
            settings: { provider: "electron", platform: "win32" },
          }),
        ]}
      />
    )
    expect(screen.getByText("Windows")).toBeInTheDocument()
    expect(screen.queryByText("Win", { exact: true })).not.toBeInTheDocument()
  })

  it("renders the local-laptop icon for electron rows (not phosphor's Laptop)", () => {
    const { container } = render(
      <ComputersBody
        {...baseProps}
        cloudMachines={[]}
        electronMachines={[
          machine({
            id: "e1",
            displayName: "prate-mbp",
            settings: { provider: "electron", platform: "darwin" },
          }),
        ]}
      />
    )
    expect(
      container.querySelector('[data-icon="local-laptop"]')
    ).toBeInTheDocument()
  })

  it("renders the cloud-desktop icon for cloud rows", () => {
    const { container } = render(
      <ComputersBody
        {...baseProps}
        cloudMachines={[
          machine({ id: "c1", displayName: "alpha" }),
        ]}
        electronMachines={[]}
      />
    )
    expect(
      container.querySelector('[data-icon="cloud-desktop"]')
    ).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 5. Source-level invariants — popover height + colour-language regressions
// ---------------------------------------------------------------------------

import * as fs from "node:fs"
import * as path from "node:path"

describe("VMSelector source invariants", () => {
  const file = path.resolve(
    __dirname,
    "../../components/common/vm-selector/vm-selector.tsx"
  )
  const source = fs.readFileSync(file, "utf8")

  it("has a viewport-bounded max-height on PopoverContent so the popup always fits", () => {
    // The popover is anchored to the chat-input bar at the bottom of the
    // viewport. A naive 100vh-based cap is wrong — it ignores where the
    // trigger sits — so we require the Radix-supplied available-height.
    expect(source).toMatch(
      /max-h-\[min\([^\]]*var\(--radix-popover-content-available-height[^\]]*\)\]/
    )
  })

  it("provides a fallback for --radix-popover-content-available-height", () => {
    // Radix sets the variable AFTER positioning. On the first paint it's
    // unresolved, so we need a sensible fallback or the cap silently no-ops.
    const popoverBlock = source.match(/<PopoverContent[\s\S]+?>/)?.[0] || ""
    expect(popoverBlock).toMatch(
      /var\(--radix-popover-content-available-height\s*,\s*[^)]+\)/
    )
  })

  it("prefers opening above the trigger (chat input is bottom-anchored)", () => {
    expect(source).toMatch(/<PopoverContent[\s\S]{0,200}side="top"/)
  })

  it("uses collisionPadding so the popover keeps off the viewport edge", () => {
    expect(source).toMatch(/<PopoverContent[\s\S]{0,300}collisionPadding=\{?\d+/)
  })

  it("uses flex column on PopoverContent so body can scroll independently", () => {
    // The popover must lay out as: fixed header → scrollable body → fixed footer.
    expect(source).toMatch(/PopoverContent[\s\S]{0,400}flex flex-col/)
  })

  it("scrolling lives on the body wrapper, not the inner list", () => {
    // The inner ComputersBody must not re-add its own max-height — that
    // would fight the parent constraint and let large lists overflow.
    const computersBodyBlock = source.match(
      /export function ComputersBody[\s\S]+?\n}\s*\n/
    )?.[0]
    expect(computersBodyBlock).toBeTruthy()
    expect(computersBodyBlock!).not.toMatch(/max-h-\[\d+px\]/)
  })

  it("never reintroduces the bright cloud/local tile design", () => {
    const sectionHeaderBlock = source.match(
      /export function SectionHeader[\s\S]+?\n}\s*\n/
    )?.[0]
    expect(sectionHeaderBlock).toBeTruthy()
    // Section headers must stay neutral. Coloured tiles were rolled back.
    expect(sectionHeaderBlock!).not.toMatch(/bg-blue-500\//)
    expect(sectionHeaderBlock!).not.toMatch(/bg-emerald-500\//)
    expect(sectionHeaderBlock!).toMatch(/text-muted-foreground/)
  })

  it("subtitle is provider-neutral — no 'Linux' wording in cloud copy", () => {
    expect(source).not.toMatch(/Linux desktops on Coasty/i)
  })

  it("separators use the FadeRule (gradient hairline), not flat borders", () => {
    // The helper itself must exist and use a transparent→border→transparent gradient.
    expect(source).toMatch(/function FadeRule/)
    expect(source).toMatch(
      /bg-gradient-to-r\s+from-transparent\s+via-border\s+to-transparent/
    )
    // Three semantic separator slots — mode-switcher → body, body → footer,
    // and the inter-section divider — must NOT reintroduce a flat border line.
    expect(source).not.toMatch(/border-b border-border\/50/)
    expect(source).not.toMatch(/border-t border-border\/50/)
    expect(source).not.toMatch(/my-[0-9.]+ border-t border-border/)
  })

  it("FadeRule is the divider used between Cloud and Your Computers", () => {
    // Inter-section divider must specifically be a <FadeRule>.
    expect(source).toMatch(
      /cloudMachines\.length > 0 && electronMachines\.length > 0[\s\S]{0,80}<FadeRule/
    )
  })

  it("scroll affordance — useScrollEdges hook exists and tracks an element", () => {
    expect(source).toMatch(/function useScrollEdges/)
    // The hook must (re)attach scroll + ResizeObserver + MutationObserver so
    // it survives AnimatePresence remounts and content changes.
    expect(source).toMatch(/addEventListener\("scroll"/)
    expect(source).toMatch(/new ResizeObserver/)
    expect(source).toMatch(/new MutationObserver/)
  })

  it("scroll affordance — ScrollFades renders fade-from-popover gradients", () => {
    expect(source).toMatch(/function ScrollFades/)
    // Must use the popover background colour for the fade so the gradient
    // matches the surrounding chrome (premium look, not a flat shadow).
    expect(source).toMatch(/from-popover[\s\S]{0,80}to-transparent/)
    // Bouncing CaretDown hint at the bottom edge.
    const scrollFadesBlock = source.match(/function ScrollFades[\s\S]+?\n}\s*\n/)?.[0] || ""
    expect(scrollFadesBlock).toMatch(/repeat:\s*Infinity/)
    expect(scrollFadesBlock).toMatch(/<CaretDown/)
  })

  it("scroll affordance — fades are wired to the active body scroll element", () => {
    // Both motion.divs (computers + swarm) must forward their ref to the
    // shared scrollEl state so tab swaps don't strand the fades.
    const matches = source.match(/ref=\{setScrollEl\}/g) || []
    expect(matches.length).toBeGreaterThanOrEqual(2)
    // The body wrapper must mount <ScrollFades> with top/bottom props.
    expect(source).toMatch(/<ScrollFades\s+top=\{scrollEdges\.top\}\s+bottom=\{scrollEdges\.bottom\}/)
  })
})
