import { describe, it, expect } from "vitest"
import {
  API_ROUTE_CHAT,
  API_ROUTE_UPDATE_CHAT_MODEL,
  API_ROUTE_CSRF,
} from "@/lib/routes"

describe("routes", () => {
  it("exports correct chat route", () => {
    expect(API_ROUTE_CHAT).toBe("/api/chat")
  })

  it("exports correct update-chat-model route", () => {
    expect(API_ROUTE_UPDATE_CHAT_MODEL).toBe("/api/update-chat-model")
  })

  it("exports correct CSRF route", () => {
    expect(API_ROUTE_CSRF).toBe("/api/csrf")
  })

  it("all routes start with /api", () => {
    const routes = [
      API_ROUTE_CHAT,
      API_ROUTE_UPDATE_CHAT_MODEL,
      API_ROUTE_CSRF,
    ]
    for (const route of routes) {
      expect(route).toMatch(/^\/api\//)
    }
  })
})
