/**
 * Next.js API route that proxies chat requests to the Python backend
 * This properly streams the response from the Python backend
 */

import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyBearerToken } from '@/lib/supabase/bearer-auth';
import { logApiAccess } from '@/lib/observability/api-access-log';

// Python backend URL - can be configured via environment variable
// Use 127.0.0.1 instead of localhost to force IPv4
const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8001';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

export const maxDuration = 300; // 5 minutes for large messages

export async function POST(req: NextRequest) {
  // Per-request access log. Captures inputs up-front so the `finally` log
  // always fires even on early-return / throw. P3 audit fix — the
  // middleware matcher excludes /api/* so this is the only place these
  // routes appear in the structured access log. We track `responseStatus`
  // explicitly because Response objects are created at many branches and
  // some routes stream (where we don't see body progression).
  const t_start = Date.now();
  let responseStatus = 500;
  let response: Response | undefined;
  try {
    // Authenticate user — try cookies first (web), then Bearer token (Electron)
    let authUser: { id: string; email?: string } | null = null;

    const supabase = await createClient();
    if (supabase) {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (!authError && authData?.user) {
        authUser = { id: authData.user.id, email: authData.user.email ?? undefined };
      }
    }

    // Fallback: Bearer token auth (Electron desktop app)
    if (!authUser) {
      const bearer = await verifyBearerToken(req);
      if (bearer.user) {
        authUser = bearer.user;
      }
    }

    if (!authUser) {
      response = new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        }
      );
      return response;
    }

    const authData = { user: authUser };

    // Get the request body
    const body = await req.json();

    // Create an AbortController for the fetch
    const controller = new AbortController();

    // Handle client disconnection - don't throw errors
    req.signal.addEventListener('abort', () => {
      try {
        controller.abort();
      } catch {
        // Ignore abort errors
      }
    });

    // Enforce server-verified values so clients cannot tamper with auth fields
    body.user_id = authData.user.id;
    body.isAuthenticated = true;

    // Forward the request to Python backend
    let backendResponse: Response;
    try {
      backendResponse = await fetch(`${PYTHON_BACKEND_URL}/api/chat/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'X-User-ID': authData.user.id,
          ...(INTERNAL_API_KEY && { 'X-Internal-Key': INTERNAL_API_KEY }),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (fetchError: unknown) {
      // Handle abort errors from fetch specifically
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        response = new Response(
          JSON.stringify({ error: 'Request cancelled by client' }),
          {
            status: 499, // Client Closed Request
            headers: { 'Content-Type': 'application/json' }
          }
        );
        return response;
      }
      throw fetchError;
    }

    // Check if the response is ok
    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();

      // Special handling for 402 Payment Required (insufficient credits)
      if (backendResponse.status === 402) {
        // Try to parse the error text to extract credit information
        let errorMessage = errorText;
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.detail || errorData.error || errorText;
        } catch {
          // If parsing fails, use the raw text
        }

        response = new Response(
          JSON.stringify({
            error: errorMessage,
            status: 402,
            type: 'insufficient_credits'
          }),
          {
            status: 402,
            headers: { 'Content-Type': 'application/json' }
          }
        );
        return response;
      }

      // ── Backend error passthrough ────────────────────────────────────
      // Forward the backend's error body VERBATIM when it's already
      // a JSON object containing an "error" or "detail" field.
      // Re-wrapping it (the old behaviour) produced strings like:
      //   { "error": "{\"error\":\"Missing required fields\"}" }
      // …which the desktop client then displayed as the raw inner JSON
      // because its parser extracts the outer ``.error`` field and
      // shows it as-is. Passing the body through cleanly means the
      // client gets `{ "error": "Missing required fields" }` and shows
      // a readable message.
      //
      // If the backend returned non-JSON (or empty) we DO wrap so the
      // client always sees a parseable ``{ error: <message> }``
      // envelope.
      let passthrough = false
      try {
        const parsed = JSON.parse(errorText)
        if (parsed && typeof parsed === 'object' && (
          typeof parsed.error === 'string' ||
          typeof parsed.detail === 'string' ||
          'error' in parsed || 'detail' in parsed
        )) {
          passthrough = true
        }
      } catch {
        // Non-JSON body — fall through to the wrap branch.
      }
      if (passthrough) {
        response = new Response(errorText, {
          status: backendResponse.status,
          headers: { 'Content-Type': 'application/json' },
        });
        return response;
      }
      response = new Response(
        JSON.stringify({ error: errorText || 'Backend request failed' }),
        {
          status: backendResponse.status,
          headers: { 'Content-Type': 'application/json' }
        }
      );
      return response;
    }

    // Get the response body as a readable stream
    const reader = backendResponse.body?.getReader();
    if (!reader) {
      response = new Response(
        JSON.stringify({ error: 'No response stream from backend' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
      return response;
    }

    // Create a TransformStream to pass through the data

    const stream = new ReadableStream({
      async start(streamController) {
        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              streamController.close();
              break;
            }

            // Check if the request was aborted
            if (req.signal.aborted || controller.signal.aborted) {
              reader.cancel();
              streamController.close();
              break;
            }

            // Pass through the chunk directly
            streamController.enqueue(value);
          }
        } catch (error) {
          // Handle abort errors gracefully
          if (error instanceof Error && error.name === 'AbortError') {
          } else {
            // Stream error occurred
          }
          try {
            reader.cancel();
            streamController.close();
          } catch {
            // Ignore close errors
          }
        }
      },
      cancel() {
        // Clean up when the stream is cancelled
        controller.abort();
        reader.cancel().catch(() => {});
      }
    });

    // Return the streaming response with proper SSE headers
    response = new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable Nginx buffering
        'Transfer-Encoding': 'chunked',
      },
    });
    return response;

  } catch (error: unknown) {
    // Handle different types of errors
    if (error instanceof Error && error.name === 'AbortError') {
      response = new Response(
        JSON.stringify({ error: 'Request cancelled' }),
        {
          status: 499, // Client Closed Request
          headers: { 'Content-Type': 'application/json' }
        }
      );
      return response;
    }

    // Error forwarding request to backend
    response = new Response(
      JSON.stringify({ error: 'Failed to connect to backend service' }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );
    return response;
  } finally {
    responseStatus = response?.status ?? 500;
    logApiAccess(req, responseStatus, Date.now() - t_start);
  }
}
