/**
 * Predict tools — the Coasty CUA prediction API.
 *
 * predict   : screenshot + instruction → list of actions (click/type/etc.)
 * ground    : screenshot + element description → coordinates
 * ocr       : screenshot → extracted text + bounding boxes
 * parse     : pyautogui code string → structured Coasty action records
 *
 * All four are read-only / idempotent / open-world (talk to a remote API).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { CoastyClient } from "../client.js";
import { runTool } from "./_helpers.js";

const PREDICT_DESC =
  "Run a Coasty CUA prediction: given a screenshot (base64 PNG/JPEG) and a goal " +
  "(e.g. 'Click the search bar and type hello'), returns a list of actions the " +
  "agent recommends executing. Each action has type (click/type/key_press/" +
  "scroll/etc.) and parameters (x,y / text / keys / direction). Uses the " +
  "Coasty CUA v3 model by default; pass cua_version='v1' for the original.";

const GROUND_DESC =
  "Find the (x,y) coordinates of an on-screen element described in plain " +
  "language (e.g. 'the blue Submit button below the form'). Returns " +
  "{x, y, confidence}. Cheaper than predict — use when you already know " +
  "what action to take and just need the position.";

const OCR_DESC =
  "Extract all text from a screenshot. Returns text + per-fragment bounding " +
  "boxes. Useful for reading status messages, error dialogs, or table data " +
  "where you don't need full action prediction.";

const PARSE_DESC =
  "Parse a pyautogui code snippet (the format CUA agents emit) into Coasty " +
  "action records. Free — no LLM call. Use this to convert agent output to " +
  "the schema /v1/machines/{id}/actions accepts.";

export function registerPredictTools(server: McpServer, api: CoastyClient): void {
  server.registerTool(
    "coasty_predict",
    {
      title: "Predict actions from a screenshot",
      description: PREDICT_DESC,
      inputSchema: {
        screenshot: z
          .string()
          .min(20)
          .describe("Base64-encoded PNG or JPEG. May include or omit the data: URI prefix."),
        instruction: z
          .string()
          .min(1)
          .max(8000)
          .describe("What you want the agent to do, in plain language."),
        cua_version: z
          .enum(["v3", "v1"])
          .optional()
          .describe("Model version. Default v3 (faster, cheaper)."),
        screen_width: z.number().int().positive().optional(),
        screen_height: z.number().int().positive().optional(),
        max_actions: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe("Cap on returned actions. Default per tier."),
        system_prompt: z
          .string()
          .optional()
          .describe("Custom system prompt (Pro+ only)."),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) =>
      runTool(() =>
        api.post("/v1/predict", {
          screenshot: args.screenshot.startsWith("data:")
            ? args.screenshot.split(",", 2)[1]
            : args.screenshot,
          instruction: args.instruction,
          cua_version: args.cua_version,
          screen_width: args.screen_width,
          screen_height: args.screen_height,
          max_actions: args.max_actions,
          system_prompt: args.system_prompt,
        }),
      ),
  );

  server.registerTool(
    "coasty_ground",
    {
      title: "Find element coordinates",
      description: GROUND_DESC,
      inputSchema: {
        screenshot: z.string().min(20).describe("Base64 PNG/JPEG."),
        description: z
          .string()
          .min(1)
          .max(2000)
          .describe("Plain-language description of the element to locate."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) =>
      runTool(() =>
        api.post("/v1/ground", {
          screenshot: args.screenshot.startsWith("data:")
            ? args.screenshot.split(",", 2)[1]
            : args.screenshot,
          description: args.description,
        }),
      ),
  );

  server.registerTool(
    "coasty_ocr",
    {
      title: "Extract text from a screenshot",
      description: OCR_DESC,
      inputSchema: {
        screenshot: z.string().min(20).describe("Base64 PNG/JPEG."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) =>
      runTool(() =>
        api.post("/v1/ocr", {
          screenshot: args.screenshot.startsWith("data:")
            ? args.screenshot.split(",", 2)[1]
            : args.screenshot,
        }),
      ),
  );

  server.registerTool(
    "coasty_parse",
    {
      title: "Parse pyautogui code into action records",
      description: PARSE_DESC,
      inputSchema: {
        code: z
          .string()
          .min(1)
          .max(50_000)
          .describe("pyautogui code string from a CUA agent output."),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        // True because parse still calls /v1/parse — invariant: every Coasty
        // tool talks to our remote API, so openWorldHint is uniformly true.
        openWorldHint: true,
      },
    },
    async (args) => runTool(() => api.post("/v1/parse", { code: args.code })),
  );
}
