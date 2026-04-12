import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  getCurrentTemporalInfo,
  createTemporalContext,
  createDetailedTemporalContext,
  formatDateForSearchResults,
  getDateStringForMockResults,
} from "@/lib/date-utils"

describe("date-utils", () => {
  // Use a fixed date for deterministic tests
  const FIXED_DATE = new Date("2026-04-04T14:30:00Z")

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_DATE)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Derive expected values from FIXED_DATE the same way the source does,
  // so tests pass regardless of the runner's local timezone.
  const expectedYear = FIXED_DATE.getFullYear()
  const expectedMonth = FIXED_DATE.toLocaleDateString("en-US", { month: "long" })
  const expectedMonthNumber = FIXED_DATE.getMonth() + 1
  const expectedDay = FIXED_DATE.getDate()
  const expectedDayOfWeek = FIXED_DATE.toLocaleDateString("en-US", { weekday: "long" })
  const expectedDateFormatted = FIXED_DATE.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
  const expectedShortDate = FIXED_DATE.toLocaleDateString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })

  describe("getCurrentTemporalInfo", () => {
    it("returns all expected fields", () => {
      const info = getCurrentTemporalInfo()
      expect(info).toHaveProperty("currentDate")
      expect(info).toHaveProperty("currentDateFormatted")
      expect(info).toHaveProperty("currentYear")
      expect(info).toHaveProperty("currentMonth")
      expect(info).toHaveProperty("currentMonthNumber")
      expect(info).toHaveProperty("currentDay")
      expect(info).toHaveProperty("currentDayOfWeek")
      expect(info).toHaveProperty("currentTime")
      expect(info).toHaveProperty("timezone")
      expect(info).toHaveProperty("iso")
    })

    it("returns the correct year", () => {
      expect(getCurrentTemporalInfo().currentYear).toBe(expectedYear)
    })

    it("returns the correct month number (1-indexed)", () => {
      const info = getCurrentTemporalInfo()
      expect(info.currentMonthNumber).toBe(expectedMonthNumber)
      expect(info.currentMonthNumber).toBeGreaterThanOrEqual(1)
      expect(info.currentMonthNumber).toBeLessThanOrEqual(12)
    })

    it("returns the correct day derived from FIXED_DATE", () => {
      expect(getCurrentTemporalInfo().currentDay).toBe(expectedDay)
    })

    it("returns the correct day of week derived from FIXED_DATE", () => {
      expect(getCurrentTemporalInfo().currentDayOfWeek).toBe(expectedDayOfWeek)
    })

    it("currentDay is a number type, not a string", () => {
      expect(typeof getCurrentTemporalInfo().currentDay).toBe("number")
    })

    it("currentDate format matches MM/DD/YYYY pattern", () => {
      const info = getCurrentTemporalInfo()
      expect(info.currentDate).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
    })

    it("currentDateFormatted format matches 'Month D, YYYY' pattern", () => {
      const info = getCurrentTemporalInfo()
      expect(info.currentDateFormatted).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/)
    })

    it("timezone is a non-empty string", () => {
      const info = getCurrentTemporalInfo()
      expect(typeof info.timezone).toBe("string")
      expect(info.timezone.length).toBeGreaterThan(0)
    })

    it("iso is a valid ISO string that parses back to the same time", () => {
      const info = getCurrentTemporalInfo()
      expect(() => new Date(info.iso)).not.toThrow()
      const parsed = new Date(info.iso)
      expect(parsed.getTime()).toBe(FIXED_DATE.getTime())
    })
  })

  describe("createTemporalContext", () => {
    it("matches the exact expected format", () => {
      const ctx = createTemporalContext()
      const expected = `Today is ${expectedDayOfWeek}, ${expectedDateFormatted} (${expectedShortDate}). The current year is ${expectedYear}.`
      expect(ctx).toBe(expected)
    })
  })

  describe("createDetailedTemporalContext", () => {
    it("includes all required fields", () => {
      const ctx = createDetailedTemporalContext()
      expect(ctx).toContain("CURRENT TEMPORAL CONTEXT")
      expect(ctx).toContain("Today's Date:")
      expect(ctx).toContain("Current Year:")
      expect(ctx).toContain("Current Month:")
      expect(ctx).toContain("Time Zone:")
    })

    it("includes the correct year and month values", () => {
      const ctx = createDetailedTemporalContext()
      expect(ctx).toContain(String(expectedYear))
      expect(ctx).toContain(expectedMonth)
    })

    it("includes search guidance", () => {
      const ctx = createDetailedTemporalContext()
      expect(ctx).toContain("latest")
      expect(ctx).toContain("recent")
    })
  })

  describe("formatDateForSearchResults", () => {
    it("returns exact format 'Month Year'", () => {
      const result = formatDateForSearchResults()
      expect(result).toBe(`${expectedMonth} ${expectedYear}`)
    })
  })

  describe("getDateStringForMockResults", () => {
    it("matches getCurrentTemporalInfo().currentDateFormatted", () => {
      const result = getDateStringForMockResults()
      expect(result).toBe(expectedDateFormatted)
    })
  })

  describe("edge cases", () => {
    afterEach(() => {
      // Restore FIXED_DATE for other test groups
      vi.setSystemTime(FIXED_DATE)
    })

    it("handles midnight boundary correctly", () => {
      const midnight = new Date("2026-04-05T00:00:00Z")
      vi.setSystemTime(midnight)
      const info = getCurrentTemporalInfo()
      const expectedMidnightDay = midnight.getDate()
      const expectedMidnightDayOfWeek = midnight.toLocaleDateString("en-US", { weekday: "long" })
      expect(info.currentDay).toBe(expectedMidnightDay)
      expect(info.currentDayOfWeek).toBe(expectedMidnightDayOfWeek)
      expect(info.currentYear).toBe(midnight.getFullYear())
    })

    it("handles New Year's Eve correctly", () => {
      const nye = new Date("2026-12-31T23:59:59Z")
      vi.setSystemTime(nye)
      const info = getCurrentTemporalInfo()
      const expectedNyeYear = nye.getFullYear()
      const expectedNyeMonth = nye.toLocaleDateString("en-US", { month: "long" })
      const expectedNyeDay = nye.getDate()
      expect(info.currentYear).toBe(expectedNyeYear)
      expect(info.currentMonth).toBe(expectedNyeMonth)
      expect(info.currentDay).toBe(expectedNyeDay)
    })

    it("handles leap year date correctly", () => {
      const leapDay = new Date("2028-02-29T12:00:00Z")
      vi.setSystemTime(leapDay)
      const info = getCurrentTemporalInfo()
      const expectedLeapDay = leapDay.getDate()
      const expectedLeapMonth = leapDay.toLocaleDateString("en-US", { month: "long" })
      expect(info.currentDay).toBe(expectedLeapDay)
      expect(info.currentMonth).toBe(expectedLeapMonth)
      expect(info.currentYear).toBe(2028)
    })
  })
})
