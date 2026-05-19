"use client"

import { useEffect } from "react"
import { SVG_SYSTEM_STACK } from "@/lib/fonts"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Global error:", error)
  }, [error])

  return (
    <html lang="en">
      <body>
        <div
          style={{
            display: "flex",
            height: "100vh",
            width: "100vw",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: SVG_SYSTEM_STACK,
            backgroundColor: "#0a0a0a",
            color: "#fafafa",
          }}
        >
          <div style={{ textAlign: "center", maxWidth: "28rem", padding: "0 1.5rem" }}>
            <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>
              Something went wrong
            </h1>
            <p style={{ marginTop: "0.5rem", color: "#a1a1aa" }}>
              An unexpected error occurred. Please try again.
            </p>
            <button
              onClick={reset}
              style={{
                marginTop: "1rem",
                borderRadius: "0.5rem",
                backgroundColor: "#fafafa",
                color: "#0a0a0a",
                padding: "0.5rem 1rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                border: "none",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
