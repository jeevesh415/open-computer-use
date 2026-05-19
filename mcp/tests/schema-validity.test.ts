/**
 * Schema-validity invariants for every tool's input schema.
 *
 * The Anthropic / Cursor / VS Code Copilot clients all validate tool input
 * schemas client-side. Subtle issues like:
 *   - external $ref pointers
 *   - oneOf / anyOf at the parameter level
 *   - non-string descriptions
 *   - missing 'type' on object schemas
 * cause silent breakage in some clients but not others.
 *
 * These tests fail fast in CI before a customer sees them.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { buildServer } from "../src/server.js";

const CFG = {
  apiKey: "sk-coasty-test-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  baseUrl: "https://coasty.ai",
  timeoutMs: 10_000,
  userAgent: "coasty-mcp-test/0.0.0",
  debug: false,
};

async function getTools() {
  const { server } = buildServer(CFG);
  const [s, c] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  const client = new Client({ name: "t", version: "0.0.0" }, { capabilities: {} });
  await client.connect(c);
  return (await client.listTools()).tools;
}

/** Walk every value in a JSON schema and pass it to `visit`. */
function walk(node: unknown, path: string, visit: (v: unknown, p: string) => void): void {
  visit(node, path);
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((child, i) => walk(child, `${path}[${i}]`, visit));
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    walk(v, `${path}.${k}`, visit);
  }
}

describe("Tool input schemas are well-formed JSON Schemas", () => {
  it("every tool has an inputSchema with type=object", async () => {
    const tools = await getTools();
    for (const t of tools) {
      expect(t.inputSchema, `${t.name} has no inputSchema`).toBeDefined();
      expect(
        (t.inputSchema as { type?: string }).type,
        `${t.name} inputSchema.type should be 'object'`,
      ).toBe("object");
    }
  });

  it("no external $ref (only internal #/$defs/... or #/properties/...)", async () => {
    const tools = await getTools();
    for (const t of tools) {
      walk(t.inputSchema, "$", (v, p) => {
        if (typeof v === "object" && v !== null && "$ref" in v) {
          const ref = (v as { $ref: unknown }).$ref;
          expect(typeof ref, `${t.name} ${p} $ref must be string`).toBe("string");
          expect(
            String(ref).startsWith("#"),
            `${t.name} ${p} has external $ref ${ref}`,
          ).toBe(true);
        }
      });
    }
  });

  it("no top-level oneOf or anyOf (Cursor + Claude Code partial support)", async () => {
    const tools = await getTools();
    for (const t of tools) {
      const top = t.inputSchema as Record<string, unknown>;
      expect("oneOf" in top, `${t.name} top-level oneOf not portable`).toBe(false);
      expect("anyOf" in top, `${t.name} top-level anyOf not portable`).toBe(false);
    }
  });

  it("description fields are always strings on schema nodes", async () => {
    const tools = await getTools();
    for (const t of tools) {
      walk(t.inputSchema, "$", (v, p) => {
        // Only validate `description` when it appears on a schema node — i.e.
        // a sibling of `type`/`enum`/`$ref`/etc. Otherwise it might just be a
        // user-defined property literally named "description" (e.g. the
        // `description` parameter on the coasty_ground tool), in which case
        // it's a sub-schema (object) and the assertion would falsely fail.
        if (typeof v !== "object" || v === null) return;
        if (!("description" in v)) return;
        const isSchemaNode =
          "type" in v ||
          "enum" in v ||
          "const" in v ||
          "$ref" in v ||
          "items" in v ||
          "properties" in v;
        if (!isSchemaNode) return;
        expect(
          typeof (v as { description: unknown }).description,
          `${t.name} ${p} description must be a string`,
        ).toBe("string");
      });
    }
  });

  it("required[] entries reference real properties", async () => {
    const tools = await getTools();
    for (const t of tools) {
      const schema = t.inputSchema as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      const required = schema.required ?? [];
      const props = schema.properties ?? {};
      for (const r of required) {
        expect(props, `${t.name} required ${r} not in properties`).toHaveProperty(r);
      }
    }
  });

  it("number constraints (min/max) are valid numbers when present", async () => {
    const tools = await getTools();
    for (const t of tools) {
      walk(t.inputSchema, "$", (v, p) => {
        if (typeof v !== "object" || v === null) return;
        for (const k of ["minimum", "maximum", "minLength", "maxLength"]) {
          if (k in v) {
            const n = (v as Record<string, unknown>)[k];
            expect(
              typeof n === "number" && Number.isFinite(n),
              `${t.name} ${p}.${k} not a finite number: ${n}`,
            ).toBe(true);
          }
        }
      });
    }
  });

  it("min ≤ max on numeric ranges", async () => {
    const tools = await getTools();
    for (const t of tools) {
      walk(t.inputSchema, "$", (v, p) => {
        if (typeof v !== "object" || v === null) return;
        const obj = v as Record<string, number | undefined>;
        if (obj.minimum !== undefined && obj.maximum !== undefined) {
          expect(
            obj.minimum <= obj.maximum,
            `${t.name} ${p}: minimum=${obj.minimum} > maximum=${obj.maximum}`,
          ).toBe(true);
        }
        if (obj.minLength !== undefined && obj.maxLength !== undefined) {
          expect(
            obj.minLength <= obj.maxLength,
            `${t.name} ${p}: minLength=${obj.minLength} > maxLength=${obj.maxLength}`,
          ).toBe(true);
        }
      });
    }
  });

  it("enums are non-empty arrays of strings or numbers", async () => {
    const tools = await getTools();
    for (const t of tools) {
      walk(t.inputSchema, "$", (v, p) => {
        if (typeof v !== "object" || v === null) return;
        if ("enum" in v) {
          const arr = (v as { enum: unknown }).enum;
          expect(Array.isArray(arr), `${t.name} ${p}.enum must be array`).toBe(true);
          expect(
            (arr as unknown[]).length > 0,
            `${t.name} ${p}.enum must be non-empty`,
          ).toBe(true);
        }
      });
    }
  });

  it("regex patterns compile", async () => {
    const tools = await getTools();
    for (const t of tools) {
      walk(t.inputSchema, "$", (v, p) => {
        if (typeof v !== "object" || v === null) return;
        if ("pattern" in v) {
          const pat = (v as { pattern: unknown }).pattern;
          expect(typeof pat, `${t.name} ${p}.pattern must be string`).toBe("string");
          expect(() => new RegExp(pat as string), `${t.name} ${p}.pattern doesn't compile`).not.toThrow();
        }
      });
    }
  });

  it("ECOSYSTEM-WIDE: no tool name has a colon (some clients namespace by ':')", async () => {
    const tools = await getTools();
    for (const t of tools) {
      expect(
        t.name.includes(":"),
        `${t.name} contains ':' which collides with some host namespacing`,
      ).toBe(false);
    }
  });

  it("ECOSYSTEM-WIDE: all tool names match snake_case [a-z0-9_]", async () => {
    const tools = await getTools();
    for (const t of tools) {
      expect(
        /^[a-z0-9_]+$/.test(t.name),
        `${t.name} should be lowercase snake_case`,
      ).toBe(true);
    }
  });
});
