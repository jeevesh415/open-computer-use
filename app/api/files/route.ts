/**
 * Next.js API route that proxies file operations to the Python backend.
 *
 * Production routing: browser → CloudFront → public ALB :443 → frontend-tg
 * (Next.js) → THIS ROUTE → fetch(PYTHON_BACKEND_URL/api/files/<op>) →
 * internal ALB :8001 → api-internal-tg → backend file_operations.py.
 *
 * The legacy implementation built the upstream URL with string template
 * concatenation (`${PYTHON_BACKEND_URL}${endpoint}`), which silently produces
 * a malformed URL when `PYTHON_BACKEND_URL` carries an accidental trailing
 * slash (`http://host:8001/` + `/api/files/list` = `//api/files/list`).
 * Some load balancers normalize that, others don't, and the silent failure
 * mode was indistinguishable from "files don't show in deployment".
 *
 * Switched to `new URL(path, base)` which:
 *   • Strips any trailing slash on `base` automatically.
 *   • Encodes path segments correctly.
 *   • Throws synchronously if `PYTHON_BACKEND_URL` is malformed, surfacing
 *     misconfiguration immediately instead of producing a bad upstream URL.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logApiAccess } from '@/lib/observability/api-access-log';

// Python backend URL — `127.0.0.1` (not `localhost`) avoids macOS / WSL
// IPv6-vs-IPv4 resolution flakiness in dev.  In production the env var is
// set to the internal ALB DNS by `infra/aws/ecs.tf` (~ ecs.tf:160).
const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8001';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

// Log the resolved backend URL once per process so operators can confirm
// the env var resolved correctly in deployment.  Mirrors the
// `[coasty] mode=...` boot log in `middleware.ts` — single line, scannable.
let _backendUrlLogged = false
function logBackendUrlOnce() {
  if (_backendUrlLogged) return
  _backendUrlLogged = true
  // Strip credentials / query for safety even though we never put any here.
  let safeUrl = PYTHON_BACKEND_URL
  try {
    const u = new URL(PYTHON_BACKEND_URL)
    safeUrl = `${u.protocol}//${u.host}`
  } catch {
    /* PYTHON_BACKEND_URL is malformed — log it raw so operator notices */
  }
  console.log(`[Files Proxy] PYTHON_BACKEND_URL=${safeUrl} INTERNAL_API_KEY=${INTERNAL_API_KEY ? "set" : "EMPTY"}`)
}

// Allowed file operations — prevents path traversal to arbitrary backend endpoints
const ALLOWED_FILE_OPS = new Set([
  'list',
  'upload',
  'upload-multipart',
  'download',
  'download-stream',
  'delete',
  'create-folder',
]);

// Hard cap on inbound JSON payload size.  base64 file uploads inflate ~33 %, so
// a 50 MB cap maps to ~37 MB of binary file content.  We reject early via
// Content-Length so an attacker can't OOM the route by sending a 1 GB body
// that we'd otherwise materialise via req.json().  P1 audit fix.
const MAX_REQUEST_BYTES = 50 * 1024 * 1024;

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  logBackendUrlOnce();
  const reqStart = Date.now();
  // Track outgoing response + log metadata for the centralised access-log
  // emit in `finally`. Replaces the bespoke `[Files Proxy]` line so a
  // single CloudWatch query unifies API access logs across all routes.
  let outResponse: NextResponse | undefined;
  let fileOpForLog: string | null = null;
  let userIdForLog: string | undefined;
  let upstreamMsForLog: number | undefined;
  try {
    // ---- Early Content-Length cap (cheap rejection before req.json()) ----
    const contentLengthHeader = req.headers.get('content-length');
    if (contentLengthHeader) {
      const contentLength = parseInt(contentLengthHeader, 10);
      if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
        outResponse = NextResponse.json(
          {
            error: 'Request body too large',
            max_bytes: MAX_REQUEST_BYTES,
            received_bytes: contentLength,
          },
          { status: 413 }
        );
        return outResponse;
      }
    }

    // Require authenticated user
    const supabase = await createClient();
    if (!supabase) {
      outResponse = NextResponse.json({ error: 'Server error' }, { status: 500 });
      return outResponse;
    }
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) {
      outResponse = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      return outResponse;
    }
    const userId = authData.user.id;
    userIdForLog = userId;

    // Get request body
    const body = await req.json();

    // Determine the backend operation: either `?op=...` query param or
    // `body.operation` (legacy clients).  Strip from body before forwarding
    // so the backend's Pydantic validators don't reject the extra field.
    const searchParams = new URL(req.url).searchParams;
    const fileOp = searchParams.get('op') || body.operation || null;
    fileOpForLog = fileOp;
    if (body.operation) {
      delete body.operation;
    }

    if (fileOp && !ALLOWED_FILE_OPS.has(fileOp)) {
      outResponse = NextResponse.json(
        { error: `Invalid file operation: ${fileOp}` },
        { status: 400 }
      );
      return outResponse;
    }

    // Build upstream URL via `new URL(path, base)` instead of string
    // concatenation. This:
    //   • Tolerates a trailing slash on PYTHON_BACKEND_URL (`http://host/`
    //     used to produce `//api/files/list`).
    //   • Throws synchronously on a malformed PYTHON_BACKEND_URL — so a
    //     misconfigured env var lights up CloudWatch instead of silently
    //     producing an empty file panel.
    //   • Encodes the path segment correctly (the op set is hard-coded so
    //     this is belt-and-braces, but it costs nothing).
    const targetPath = fileOp ? `/api/files/${fileOp}` : '/api/files';
    let upstreamUrl: URL;
    try {
      upstreamUrl = new URL(targetPath, PYTHON_BACKEND_URL);
    } catch (e) {
      console.error(
        `[Files Proxy] PYTHON_BACKEND_URL is malformed: ${JSON.stringify(PYTHON_BACKEND_URL)} ` +
          `(error: ${e instanceof Error ? e.message : String(e)}). ` +
          `Set the env var to a valid origin (e.g. http://internal-alb:8001).`,
      );
      outResponse = NextResponse.json(
        { error: 'Backend URL misconfigured' },
        { status: 500 }
      );
      return outResponse;
    }

    // Forward the request to Python backend.
    const fetchStart = Date.now();
    const backendResponse = await fetch(upstreamUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-ID': userId,
        'X-Authenticated': 'true',
        ...(INTERNAL_API_KEY && { 'X-Internal-Key': INTERNAL_API_KEY }),
      },
      body: JSON.stringify(body),
    });
    upstreamMsForLog = Date.now() - fetchStart;

    // Check if the response is ok
    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.warn(
        `[Files Proxy] upstream non-OK: status=${backendResponse.status} ` +
          `op=${fileOp ?? '<none>'} body=${errorText.slice(0, 500)}`,
      );
      outResponse = NextResponse.json(
        { error: errorText || 'Backend request failed' },
        { status: backendResponse.status }
      );
      return outResponse;
    }

    // For download-stream endpoint, pipe the upstream body straight to the
    // client without buffering.  Previously we did `await response.blob()`
    // which materialised the entire file in memory before forwarding —
    // a 500 MB download would balloon the route's RSS by 500 MB.  Fix from
    // the P1 audit: hand the readable stream directly to NextResponse.
    if (fileOp === 'download-stream') {
      if (!backendResponse.body) {
        outResponse = NextResponse.json(
          { error: 'Backend returned empty stream' },
          { status: 502 }
        );
        return outResponse;
      }
      const headers = new Headers();
      const contentDisposition = backendResponse.headers.get('content-disposition');
      const contentType = backendResponse.headers.get('content-type');
      const contentLength = backendResponse.headers.get('content-length');
      if (contentDisposition) headers.set('Content-Disposition', contentDisposition);
      if (contentType) headers.set('Content-Type', contentType);
      if (contentLength) headers.set('Content-Length', contentLength);
      outResponse = new NextResponse(backendResponse.body, {
        status: backendResponse.status,
        headers,
      });
      return outResponse;
    }

    // For JSON responses
    const data = await backendResponse.json();
    outResponse = NextResponse.json(data);
    return outResponse;

  } catch (error) {
    console.error('[Files Proxy] Error:', error);
    outResponse = NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
    return outResponse;
  } finally {
    // Unified access-log line. Replaces the bespoke `[Files Proxy]` log
    // so CloudWatch Logs Insights can filter by `type = "api_request"`
    // across every API route.
    logApiAccess(req, outResponse?.status ?? 500, Date.now() - reqStart, {
      op: fileOpForLog ?? '<none>',
      user_id: userIdForLog,
      upstream_ms: upstreamMsForLog,
    });
  }
}