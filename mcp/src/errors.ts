/**
 * Maps Coasty API errors → MCP tool result shape.
 *
 * Coasty returns ``{ error: { code, message, type, request_id } }`` envelopes
 * on every non-2xx response (see backend/app/api/routes/public_*.py).
 *
 * We translate those into MCP tool results with ``isError: true`` rather than
 * throwing — that lets the LLM read the error message + request_id and either
 * recover (e.g. fix a malformed argument) or surface it to the user with
 * enough context to file a support ticket.
 *
 * We DO throw for transport-level failures (network, timeout) because those
 * indicate a problem outside the protocol's recovery loop.
 */

export type CoastyError = {
  status: number;
  code: string;
  message: string;
  type?: string;
  requestId?: string;
  raw?: unknown;
};

export class TransportError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "TransportError";
  }
}

/** Hint string a tool can return to the LLM to help it self-correct. */
export function describeError(err: CoastyError): string {
  const lines = [
    `Coasty API error (${err.status} ${err.code}): ${err.message}`,
  ];
  if (err.requestId) lines.push(`request_id=${err.requestId}`);
  if (err.status === 401) {
    lines.push(
      "Hint: COASTY_API_KEY may be missing, revoked, or scoped to a different environment.",
    );
  } else if (err.status === 402) {
    lines.push(
      "Hint: Insufficient credits. Check balance at https://coasty.ai/credits or use a sk-coasty-test-* key for free sandbox runs.",
    );
  } else if (err.status === 403) {
    lines.push(
      "Hint: Your API key lacks the required scope. Mint a key with the right scope at https://coasty.ai/developers.",
    );
  } else if (err.status === 404) {
    lines.push(
      "Hint: Resource not found OR not owned by this API key. Coasty returns 404 (not 403) on cross-tenant access to prevent enumeration.",
    );
  } else if (err.status === 409) {
    lines.push(
      "Hint: State conflict. The resource is in a state that disallows this operation (e.g. action on a non-running VM).",
    );
  } else if (err.status === 422) {
    lines.push(
      "Hint: Request body failed validation. Check field types, required fields, and that no extra fields are present (Coasty rejects unknown fields).",
    );
  } else if (err.status === 429) {
    lines.push("Hint: Rate-limited. Retry after the Retry-After window (1-60s).");
  } else if (err.status >= 500) {
    lines.push("Hint: Server-side error. Retry with exponential backoff or contact founders@coasty.ai.");
  }
  return lines.join("\n");
}

/** Build a tool-result content array carrying an error. */
export function errorResult(err: CoastyError | string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  const text = typeof err === "string" ? err : describeError(err);
  return { content: [{ type: "text", text }], isError: true };
}
