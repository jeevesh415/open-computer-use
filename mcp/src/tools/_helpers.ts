/**
 * Shared helpers for tool implementations.
 *
 * The pattern: each tool registers via ``server.registerTool(name, def, handler)``
 * and the handler returns ``{ content, structuredContent?, isError? }``.
 *
 * ``runTool`` wraps the handler with:
 *   * Coasty error → ``isError: true`` with describeError() text
 *   * Transport error → ``isError: true`` with raw message
 *   * Successful response → text + structuredContent (both, for max compat)
 */

import { isCoastyError } from "../client.js";
import { errorResult, type CoastyError, TransportError } from "../errors.js";

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/**
 * Wrap a handler so any thrown CoastyError / TransportError lands as an
 * MCP error result instead of bubbling up as an SDK exception.
 */
export async function runTool(
  fn: () => Promise<unknown> | unknown,
): Promise<ToolResult> {
  try {
    const out = await fn();
    return successResult(out);
  } catch (e) {
    if (isCoastyError(e)) return errorResult(e as CoastyError);
    if (e instanceof TransportError) return errorResult(e.message);
    return errorResult(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Standard success result — both text + structuredContent. */
export function successResult(payload: unknown): ToolResult {
  if (payload === undefined || payload === null) {
    return { content: [{ type: "text", text: "OK" }] };
  }
  const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  if (typeof payload === "object" && !Array.isArray(payload)) {
    return {
      content: [{ type: "text", text }],
      structuredContent: payload as Record<string, unknown>,
    };
  }
  if (Array.isArray(payload)) {
    return {
      content: [{ type: "text", text }],
      structuredContent: { data: payload },
    };
  }
  return { content: [{ type: "text", text }] };
}

/** Truncate large textual payloads so we don't blow the model's context window. */
export function truncate(value: unknown, maxChars = 8000): unknown {
  if (typeof value === "string") {
    return value.length > maxChars ? `${value.slice(0, maxChars)}\n…[truncated ${value.length - maxChars} chars]` : value;
  }
  return value;
}
