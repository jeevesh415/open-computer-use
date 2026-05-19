/**
 * Tests for `cleanMessagePreview` — the pure function that strips Coasty
 * internal markers from the denormalised `chats.last_message_preview` (added
 * in Supabase migration 009).
 *
 * The function must:
 *   1. Return null for null / undefined / empty input.
 *   2. Prefer task-plan main_objective when present.
 *   3. Fall back to a cleaned version of the raw string.
 *   4. Strip cua-section tags, code blocks, task-status markers, markdown chars.
 *   5. Collapse whitespace and truncate to 100 chars.
 *   6. Return null when cleanup collapses to empty — callers rely on that
 *      signal to render the default fallback UI.
 */
import { describe, it, expect } from "vitest"
import { cleanMessagePreview } from "@/lib/chat-store/chats/api"

describe("cleanMessagePreview", () => {
  describe("null and empty handling", () => {
    it("returns null for null input", () => {
      expect(cleanMessagePreview(null)).toBeNull()
    })

    it("returns null for undefined input", () => {
      expect(cleanMessagePreview(undefined)).toBeNull()
    })

    it("returns null for empty string", () => {
      expect(cleanMessagePreview("")).toBeNull()
    })

    it("returns null when a message is ONLY markers/whitespace", () => {
      expect(cleanMessagePreview("[TASK_STATUS:foo:bar]  ```   ```")).toBeNull()
    })
  })

  describe("plain text", () => {
    it("returns plain text unchanged", () => {
      expect(cleanMessagePreview("Hello world")).toBe("Hello world")
    })

    it("collapses multiple whitespace chars into single spaces", () => {
      expect(cleanMessagePreview("Hello   world\n\ntoday")).toBe(
        "Hello world today"
      )
    })

    it("truncates at exactly 100 chars with ellipsis", () => {
      const long = "a".repeat(200)
      const out = cleanMessagePreview(long)
      expect(out).toBeTruthy()
      expect(out!.length).toBeLessThanOrEqual(103) // 100 + "..."
      expect(out!.endsWith("...")).toBe(true)
    })

    it("does not add ellipsis under the limit", () => {
      expect(cleanMessagePreview("short")).toBe("short")
    })
  })

  describe("task plan extraction", () => {
    it("extracts main_objective when present", () => {
      const raw = `intro [TASK_PLAN_START]{"main_objective":"Book a flight to Tokyo"}[TASK_PLAN_END] outro`
      expect(cleanMessagePreview(raw)).toBe("Book a flight to Tokyo")
    })

    it("falls back to first subtask description when main_objective missing", () => {
      const raw = `[TASK_PLAN_START]{"subtasks":[{"description":"Research best routes"}]}[TASK_PLAN_END]`
      expect(cleanMessagePreview(raw)).toBe("Research best routes")
    })

    it("falls back to raw cleanup when JSON is malformed", () => {
      const raw = `[TASK_PLAN_START]not-valid-json[TASK_PLAN_END] clean text`
      const out = cleanMessagePreview(raw)
      expect(out).toBeTruthy()
      expect(out).toContain("clean text")
      expect(out).not.toContain("[TASK_PLAN_START]")
    })
  })

  describe("marker stripping", () => {
    it("strips cua-section tags but keeps inner content", () => {
      const raw = `<cua-section type="reflection">thinking here</cua-section>`
      const out = cleanMessagePreview(raw)
      expect(out).toContain("thinking here")
      expect(out).not.toContain("<cua-section")
      expect(out).not.toContain("</cua-section>")
    })

    it("strips fenced code blocks", () => {
      const raw = "Result: ```\nprint('hi')\n``` done"
      const out = cleanMessagePreview(raw)
      expect(out).toContain("Result:")
      expect(out).toContain("done")
      expect(out).not.toContain("print")
    })

    it("strips inline code ticks", () => {
      const raw = "Run `npm install` first"
      expect(cleanMessagePreview(raw)).toBe("Run first")
    })

    it("strips task-status and task-summary markers", () => {
      const raw = "[TASK_STATUS:step1:done]Work completed[TASK_SUMMARY:step1:ok]"
      expect(cleanMessagePreview(raw)).toBe("Work completed")
    })

    it("strips markdown emphasis characters", () => {
      const raw = "**bold** _italic_ ~strike~ # heading"
      const out = cleanMessagePreview(raw)
      expect(out).not.toMatch(/[*_~#]/)
      expect(out).toContain("bold")
      expect(out).toContain("heading")
    })

    it("strips markdown link-syntax characters but keeps text", () => {
      const raw = "[click me](https://example.com) for more"
      const out = cleanMessagePreview(raw)
      // brackets + parens stripped
      expect(out).not.toMatch(/[\[\]()]/)
      expect(out).toContain("click me")
    })

    it("strips reasoning/thinking blocks", () => {
      const raw =
        "[REASONING_START]private analysis[REASONING_END] [THINKING_START]inner[THINKING_END] public reply"
      expect(cleanMessagePreview(raw)).toBe("public reply")
    })
  })

  describe("edge cases", () => {
    it("handles mixed markers and text", () => {
      const raw =
        '<cua-section type="plan">Goal</cua-section>\n```\ncode\n```\n[TASK_STATUS:s:done]\nFinal answer'
      const out = cleanMessagePreview(raw)
      expect(out).toContain("Goal")
      expect(out).toContain("Final answer")
      expect(out).not.toContain("code")
      expect(out).not.toContain("TASK_STATUS")
    })

    it("handles string that is only markdown chars", () => {
      expect(cleanMessagePreview("***")).toBeNull()
    })

    it("handles string that is only whitespace after stripping", () => {
      expect(cleanMessagePreview("```only```")).toBeNull()
    })

    it("is idempotent — cleaning already-clean text is a no-op", () => {
      const clean = "Simple human-readable sentence"
      expect(cleanMessagePreview(clean)).toBe(clean)
    })

    it("handles a 500-char stored preview that truncates correctly", () => {
      // Migration 009 stores `LEFT(content, 500)`.  Confirm we don't break on
      // mid-word cuts.
      const raw = "word ".repeat(150) // 750 chars but gets truncated at 500
      const clipped = raw.substring(0, 500)
      const out = cleanMessagePreview(clipped)
      expect(out).toBeTruthy()
      expect(out!.length).toBeLessThanOrEqual(103)
    })
  })
})
