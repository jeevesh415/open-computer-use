import { ImageResponse } from "next/og"
import { SVG_SYSTEM_STACK } from "@/lib/fonts"

export const alt = "Coasty - #1 Computer-Use AI Agent"
export const size = {
  width: 1200,
  height: 630,
}
export const contentType = "image/png"

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #000000 0%, #0a0a0a 40%, #111111 100%)",
          fontFamily: SVG_SYSTEM_STACK,
        }}
      >
        {/* Logo */}
        <div
          style={{
            width: "120px",
            height: "120px",
            borderRadius: "50%",
            background: "linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.06) 25%, rgba(255,255,255,0.18) 45%, rgba(255,255,255,0.4) 60%, rgba(255,255,255,0.75) 80%, rgba(255,255,255,1) 100%)",
            marginBottom: "32px",
            display: "flex",
          }}
        />
        {/* Title */}
        <div
          style={{
            fontSize: "64px",
            fontWeight: 700,
            color: "#ffffff",
            letterSpacing: "-2px",
            marginBottom: "16px",
            display: "flex",
          }}
        >
          Coasty
        </div>
        {/* Subtitle */}
        <div
          style={{
            fontSize: "28px",
            fontWeight: 400,
            color: "rgba(255,255,255,0.6)",
            display: "flex",
          }}
        >
          #1 Computer-Use AI Agent
        </div>
      </div>
    ),
    {
      ...size,
    }
  )
}
