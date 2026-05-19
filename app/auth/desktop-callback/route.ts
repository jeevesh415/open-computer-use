import { NextResponse } from "next/server"
import { SYSTEM_SANS_STACK } from "@/lib/fonts"

/**
 * Intermediate callback page for Electron desktop OAuth.
 *
 * Flow: Supabase OAuth → this page (with ?code=) → triggers coasty:// protocol → Electron app
 *
 * This prevents the browser from showing a blank/loading tab after the custom protocol redirect.
 * The actual code exchange happens in the Electron app's Supabase client (which holds the PKCE code_verifier).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")

  const params = new URLSearchParams()
  if (code) params.set("code", code)
  const protocolUrl = `coasty://auth/callback${params.toString() ? `?${params.toString()}` : ""}`

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Redirecting to Coasty</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:${SYSTEM_SANS_STACK};background:#0a0a0a;color:#fff;padding:20px}
    .card{text-align:center;display:flex;flex-direction:column;align-items:center;gap:20px;max-width:400px;opacity:0;animation:slideUp .5s cubic-bezier(.22,1,.36,1) forwards}
    .logo{width:40px;height:40px}
    h2{font-size:20px;font-weight:600;letter-spacing:-.02em}
    p{font-size:14px;color:#a3a3a3;line-height:1.6}
    .subtle{font-size:12px;color:#525252}
    a{color:#60a5fa;text-decoration:none}
    a:hover{text-decoration:underline}
    .spinner{width:28px;height:28px;border:2.5px solid rgba(255,255,255,.08);border-top-color:rgba(255,255,255,.7);border-radius:50%;animation:spin .7s linear infinite}
    .success{display:none}
    .check{width:36px;height:36px;border-radius:50%;background:rgba(16,185,129,.12);display:flex;align-items:center;justify-content:center}
    .check svg{width:20px;height:20px;color:#10b981}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes slideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
  </style>
</head>
<body>
  <div class="card">
    <svg class="logo" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="g" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="rgba(255,255,255,0)"/>
        <stop offset="30%" stop-color="rgba(255,255,255,.1)"/>
        <stop offset="50%" stop-color="rgba(255,255,255,.3)"/>
        <stop offset="70%" stop-color="rgba(255,255,255,.6)"/>
        <stop offset="100%" stop-color="#fff"/>
      </linearGradient></defs>
      <circle cx="100" cy="100" r="100" fill="url(#g)"/>
    </svg>
    <div id="loading">
      <div style="display:flex;flex-direction:column;align-items:center;gap:16px">
        <div class="spinner"></div>
        <h2>Opening Coasty</h2>
        <p>Launching the desktop app&hellip;</p>
      </div>
    </div>
    <div id="done" class="success">
      <div style="display:flex;flex-direction:column;align-items:center;gap:16px">
        <div class="check">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <h2>You're all set</h2>
        <p>Coasty is ready on your desktop.<br>You can close this tab.</p>
      </div>
    </div>
    <p class="subtle">Didn't work? <a href="${protocolUrl.replace(/"/g, "&quot;")}">Click here to open Coasty</a></p>
  </div>
  <script>
    // Trigger the custom protocol to hand off the auth code to the Electron app
    window.location.href = ${JSON.stringify(protocolUrl)};

    // After a short delay, swap spinner for the success state
    setTimeout(function() {
      document.getElementById('loading').style.display = 'none';
      var done = document.getElementById('done');
      done.style.display = 'block';
      done.style.opacity = '0';
      done.style.animation = 'slideUp .5s cubic-bezier(.22,1,.36,1) forwards';
    }, 1500);

    // Try to auto-close the tab (only works if the tab was opened by script)
    setTimeout(function() { window.close(); }, 4000);
  </script>
</body>
</html>`

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  })
}
