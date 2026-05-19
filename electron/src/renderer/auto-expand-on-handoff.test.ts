/**
 * Tests for the auto-expand-on-handoff / auto-collapse-on-resume effect
 * in App.tsx. The Electron overlay should jump to expanded mode when the
 * agent enters AWAITING_HUMAN so the user doesn't miss the prompt — and
 * collapse back to compact when they click "Done, Continue", BUT only if
 * we were the ones who auto-expanded.
 *
 * If the user manually expanded the overlay before the handoff began,
 * yanking them back to compact when they resume would be surprising
 * (they were reading the chat — they might want to keep reading). So the
 * effect tracks whether IT triggered the expansion and only undoes its
 * own work.
 *
 * This file exercises the same state-machine the App.tsx useEffect
 * implements, as a pure function. We can't render React here (no
 * @testing-library/react in the Electron test stack), so we mirror the
 * decision rules and pin them.
 */
import { describe, it, expect, beforeEach } from 'vitest'

type WindowMode = 'auth' | 'compact' | 'expanded'

interface AwaitingHumanState {
  reason: string
  machineId: string
  since: number
}

interface EffectInput {
  prevAwaitingHuman: AwaitingHumanState | null
  nextAwaitingHuman: AwaitingHumanState | null
  mode: WindowMode
  /** Mutable ref carried across calls — same as useRef in React */
  autoExpandedRef: { current: boolean }
}

interface EffectAction {
  setMode: WindowMode | null
  refValue: boolean
}

/**
 * Pure-function mirror of the useEffect in App.tsx.
 * Returns the action the effect should take + the new ref value.
 *
 * This DOES NOT mutate ``input.autoExpandedRef`` — the test driver
 * applies the returned ``refValue`` if a real React effect would have.
 */
function handoffExpansionEffect(input: EffectInput): EffectAction {
  const { nextAwaitingHuman, mode, autoExpandedRef } = input

  if (nextAwaitingHuman) {
    // Handoff started.
    if (mode === 'compact') {
      return { setMode: 'expanded', refValue: true }
    }
    // Already expanded (or in auth) — leave alone.
    return { setMode: null, refValue: autoExpandedRef.current }
  } else {
    // Handoff cleared.
    if (autoExpandedRef.current && mode === 'expanded') {
      return { setMode: 'compact', refValue: false }
    }
    // We didn't auto-expand, OR mode isn't expanded — clean up the ref
    // and don't change mode.
    return { setMode: null, refValue: false }
  }
}


// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAwaiting(): AwaitingHumanState {
  return { reason: 'Sign in needed', machineId: 'm-1', since: Date.now() }
}


// ── Auto-expand on handoff ──────────────────────────────────────────────────


describe('Auto-expand on handoff entry', () => {
  let ref: { current: boolean }

  beforeEach(() => {
    ref = { current: false }
  })

  it('compact + handoff arrives → expand and mark autoExpanded', () => {
    const result = handoffExpansionEffect({
      prevAwaitingHuman: null,
      nextAwaitingHuman: makeAwaiting(),
      mode: 'compact',
      autoExpandedRef: ref,
    })
    expect(result.setMode).toBe('expanded')
    expect(result.refValue).toBe(true)
  })

  it('expanded + handoff arrives → leave alone, do NOT mark autoExpanded', () => {
    const result = handoffExpansionEffect({
      prevAwaitingHuman: null,
      nextAwaitingHuman: makeAwaiting(),
      mode: 'expanded',
      autoExpandedRef: ref,
    })
    expect(result.setMode).toBeNull()
    expect(result.refValue).toBe(false)
  })

  it('auth + handoff arrives → leave alone (defensive — should not happen)', () => {
    // The 'auth' mode means the user isn't signed in; awaiting-human
    // shouldn't reach this state, but be defensive.
    const result = handoffExpansionEffect({
      prevAwaitingHuman: null,
      nextAwaitingHuman: makeAwaiting(),
      mode: 'auth',
      autoExpandedRef: ref,
    })
    expect(result.setMode).toBeNull()
    expect(result.refValue).toBe(false)
  })
})


// ── Auto-collapse on resume ────────────────────────────────────────────────


describe('Auto-collapse on handoff resume', () => {
  it('expanded + we auto-expanded + resume → collapse and reset ref', () => {
    const ref = { current: true }
    const result = handoffExpansionEffect({
      prevAwaitingHuman: makeAwaiting(),
      nextAwaitingHuman: null,
      mode: 'expanded',
      autoExpandedRef: ref,
    })
    expect(result.setMode).toBe('compact')
    expect(result.refValue).toBe(false)
  })

  it('expanded + user manually expanded + resume → STAY expanded', () => {
    // The critical "don't surprise the user" case. If autoExpandedRef is
    // false (we never auto-expanded), the user must have manually clicked
    // expand before the handoff. Leave them where they are.
    const ref = { current: false }
    const result = handoffExpansionEffect({
      prevAwaitingHuman: makeAwaiting(),
      nextAwaitingHuman: null,
      mode: 'expanded',
      autoExpandedRef: ref,
    })
    expect(result.setMode).toBeNull()
    expect(result.refValue).toBe(false)
  })

  it('compact + resume → no-op', () => {
    // User manually collapsed mid-handoff (before resume) — nothing to do.
    const ref = { current: true }
    const result = handoffExpansionEffect({
      prevAwaitingHuman: makeAwaiting(),
      nextAwaitingHuman: null,
      mode: 'compact',
      autoExpandedRef: ref,
    })
    expect(result.setMode).toBeNull()
    // ref still gets reset for cleanliness.
    expect(result.refValue).toBe(false)
  })

  it('auth + resume → no-op (cleanup ref)', () => {
    const ref = { current: true }
    const result = handoffExpansionEffect({
      prevAwaitingHuman: makeAwaiting(),
      nextAwaitingHuman: null,
      mode: 'auth',
      autoExpandedRef: ref,
    })
    expect(result.setMode).toBeNull()
    expect(result.refValue).toBe(false)
  })
})


// ── Full lifecycle simulations ─────────────────────────────────────────────


describe('Full lifecycle: compact → handoff → resume → compact', () => {
  it('happy path: auto-expand and auto-collapse', () => {
    const ref = { current: false }
    let mode: WindowMode = 'compact'

    // 1. Handoff starts.
    let r = handoffExpansionEffect({
      prevAwaitingHuman: null,
      nextAwaitingHuman: makeAwaiting(),
      mode,
      autoExpandedRef: ref,
    })
    if (r.setMode) mode = r.setMode
    ref.current = r.refValue
    expect(mode).toBe('expanded')
    expect(ref.current).toBe(true)

    // 2. User clicks Done, Continue → resume.
    r = handoffExpansionEffect({
      prevAwaitingHuman: makeAwaiting(),
      nextAwaitingHuman: null,
      mode,
      autoExpandedRef: ref,
    })
    if (r.setMode) mode = r.setMode
    ref.current = r.refValue
    expect(mode).toBe('compact')
    expect(ref.current).toBe(false)
  })
})


describe('Full lifecycle: user-manually-expanded → handoff → resume', () => {
  it('respects user choice: stays expanded on resume', () => {
    const ref = { current: false }
    let mode: WindowMode = 'expanded'  // user already expanded manually

    // 1. Handoff starts. Already expanded — no setMode.
    let r = handoffExpansionEffect({
      prevAwaitingHuman: null,
      nextAwaitingHuman: makeAwaiting(),
      mode,
      autoExpandedRef: ref,
    })
    if (r.setMode) mode = r.setMode
    ref.current = r.refValue
    expect(mode).toBe('expanded')
    expect(ref.current).toBe(false)

    // 2. User clicks Done, Continue.
    r = handoffExpansionEffect({
      prevAwaitingHuman: makeAwaiting(),
      nextAwaitingHuman: null,
      mode,
      autoExpandedRef: ref,
    })
    if (r.setMode) mode = r.setMode
    ref.current = r.refValue
    expect(mode).toBe('expanded')  // STAYED expanded
    expect(ref.current).toBe(false)
  })
})


describe('Edge case: user toggles mode mid-handoff', () => {
  it('user collapses mid-handoff → resume is a no-op (no auto-collapse)', () => {
    const ref = { current: false }
    let mode: WindowMode = 'compact'

    // 1. Handoff starts.
    let r = handoffExpansionEffect({
      prevAwaitingHuman: null,
      nextAwaitingHuman: makeAwaiting(),
      mode,
      autoExpandedRef: ref,
    })
    if (r.setMode) mode = r.setMode
    ref.current = r.refValue
    expect(mode).toBe('expanded')
    expect(ref.current).toBe(true)

    // 2. User manually collapses mid-handoff. The window-store calls
    //    setMode('compact') but the App effect doesn't re-run because
    //    its dependencies don't include `mode`. The ref stays true.
    //    (We don't simulate the effect here — the change came from user
    //    interaction, not awaitingHuman.)
    mode = 'compact'

    // 3. User clicks Done, Continue → resume. mode is compact, so the
    //    auto-collapse branch's condition (`mode === 'expanded'`) is
    //    false — no-op. Ref resets cleanly.
    r = handoffExpansionEffect({
      prevAwaitingHuman: makeAwaiting(),
      nextAwaitingHuman: null,
      mode,
      autoExpandedRef: ref,
    })
    if (r.setMode) mode = r.setMode
    ref.current = r.refValue
    expect(mode).toBe('compact')  // unchanged
    expect(ref.current).toBe(false)
  })

  it('user expands mid-compact-handoff (already expanded by us) → no double-expand', () => {
    const ref = { current: true }
    // We previously set mode to expanded at the start of handoff.
    // User clicks the expand button (no-op in expanded state, or maybe
    // collapses then re-expands — we just check what happens when the
    // effect re-fires while mode is already expanded.)
    const r = handoffExpansionEffect({
      prevAwaitingHuman: makeAwaiting(),  // SAME awaiting state
      nextAwaitingHuman: makeAwaiting(),
      mode: 'expanded',
      autoExpandedRef: ref,
    })
    // Effect re-firing with same awaitingHuman — should not re-call
    // setMode, should preserve ref so resume still auto-collapses.
    expect(r.setMode).toBeNull()
    expect(r.refValue).toBe(true)
  })
})


// ── Defensive cases ────────────────────────────────────────────────────────


describe('Defensive — no-ops when nothing changed', () => {
  it('null → null (no transition) → no action', () => {
    const ref = { current: false }
    const r = handoffExpansionEffect({
      prevAwaitingHuman: null,
      nextAwaitingHuman: null,
      mode: 'compact',
      autoExpandedRef: ref,
    })
    expect(r.setMode).toBeNull()
    expect(r.refValue).toBe(false)
  })

  it('null → null with stale ref=true on compact mode → resets ref only', () => {
    // Defensive cleanup — if somehow ref stayed true while
    // awaitingHuman is null AND mode is already compact, we clear the
    // ref but don't touch the mode (we're already where we'd want to be).
    // (In real React this effect only re-runs when awaitingHuman changes,
    // so this state path shouldn't arise in practice — but pin the
    // pure-function behavior so any future hand-off-resume bug doesn't
    // leak the dirty ref into a permanent auto-collapse.)
    const ref = { current: true }
    const r = handoffExpansionEffect({
      prevAwaitingHuman: null,
      nextAwaitingHuman: null,
      mode: 'compact',
      autoExpandedRef: ref,
    })
    expect(r.setMode).toBeNull()
    expect(r.refValue).toBe(false)
  })
})


// ── Multiple consecutive handoffs ─────────────────────────────────────────


describe('Multiple handoffs in one session', () => {
  it('handoff → resume → handoff → resume cycles correctly', () => {
    const ref = { current: false }
    let mode: WindowMode = 'compact'
    const a1 = makeAwaiting()
    const a2: AwaitingHumanState = {
      reason: 'second handoff', machineId: 'm-1', since: Date.now() + 1000,
    }

    // First handoff.
    let r = handoffExpansionEffect({
      prevAwaitingHuman: null,
      nextAwaitingHuman: a1,
      mode,
      autoExpandedRef: ref,
    })
    if (r.setMode) mode = r.setMode
    ref.current = r.refValue
    expect(mode).toBe('expanded')
    expect(ref.current).toBe(true)

    // First resume.
    r = handoffExpansionEffect({
      prevAwaitingHuman: a1,
      nextAwaitingHuman: null,
      mode,
      autoExpandedRef: ref,
    })
    if (r.setMode) mode = r.setMode
    ref.current = r.refValue
    expect(mode).toBe('compact')
    expect(ref.current).toBe(false)

    // Second handoff (different reason).
    r = handoffExpansionEffect({
      prevAwaitingHuman: null,
      nextAwaitingHuman: a2,
      mode,
      autoExpandedRef: ref,
    })
    if (r.setMode) mode = r.setMode
    ref.current = r.refValue
    expect(mode).toBe('expanded')
    expect(ref.current).toBe(true)

    // Second resume.
    r = handoffExpansionEffect({
      prevAwaitingHuman: a2,
      nextAwaitingHuman: null,
      mode,
      autoExpandedRef: ref,
    })
    if (r.setMode) mode = r.setMode
    ref.current = r.refValue
    expect(mode).toBe('compact')
    expect(ref.current).toBe(false)
  })
})
