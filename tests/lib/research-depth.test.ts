import { describe, it, expect } from "vitest"
import {
  RESEARCH_DEPTH_CONFIG,
  getSearchResultsCount,
  type ResearchDepth,
} from "@/lib/research-depth"

describe("research-depth", () => {
  describe("RESEARCH_DEPTH_CONFIG", () => {
    it("has exactly 3 depth levels", () => {
      expect(RESEARCH_DEPTH_CONFIG).toHaveLength(3)
    })

    it("includes quick, moderate, and deep", () => {
      const ids = RESEARCH_DEPTH_CONFIG.map((c) => c.id)
      expect(ids).toEqual(["quick", "moderate", "deep"])
    })

    it("each config has required fields", () => {
      for (const config of RESEARCH_DEPTH_CONFIG) {
        expect(config).toHaveProperty("id")
        expect(config).toHaveProperty("name")
        expect(config).toHaveProperty("description")
        expect(config).toHaveProperty("searchResults")
        expect(typeof config.searchResults).toBe("number")
      }
    })

    it("search results increase with depth", () => {
      const results = RESEARCH_DEPTH_CONFIG.map((c) => c.searchResults)
      expect(results[0]).toBeLessThan(results[1])
      expect(results[1]).toBeLessThan(results[2])
    })
  })

  describe("getSearchResultsCount", () => {
    it("returns 3 for quick", () => {
      expect(getSearchResultsCount("quick")).toBe(3)
    })

    it("returns 5 for moderate", () => {
      expect(getSearchResultsCount("moderate")).toBe(5)
    })

    it("returns 10 for deep", () => {
      expect(getSearchResultsCount("deep")).toBe(10)
    })

    it("returns 5 as default for unknown depth", () => {
      expect(getSearchResultsCount("unknown" as ResearchDepth)).toBe(5)
    })
  })
})
