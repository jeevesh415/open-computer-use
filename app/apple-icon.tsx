import { ImageResponse } from "next/og"

export const size = {
  width: 180,
  height: 180,
}

export const contentType = "image/png"

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0a0a0a 0%, #171717 100%)",
          borderRadius: "38px",
        }}
      >
        <div
          style={{
            width: "112px",
            height: "112px",
            borderRadius: "50%",
            background: "linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.06) 25%, rgba(255,255,255,0.18) 45%, rgba(255,255,255,0.4) 60%, rgba(255,255,255,0.75) 80%, rgba(255,255,255,1) 100%)",
            display: "flex",
          }}
        />
      </div>
    ),
    {
      ...size,
    }
  )
}
