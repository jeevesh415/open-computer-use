import { NextResponse } from "next/server"

const PYTHON_BACKEND_URL =
  process.env.PYTHON_BACKEND_URL || "http://127.0.0.1:8001"

export async function GET() {
  try {
    const res = await fetch(`${PYTHON_BACKEND_URL}/api/status/history`, {
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json()
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=60" },
    })
  } catch {
    return NextResponse.json(
      { services: [], has_data: false },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } }
    )
  }
}
