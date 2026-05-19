/**
 * Coasty Public API — OpenAPI 3.1 specification
 *
 * Hand-curated, public-only surface. The FastAPI backend deliberately blocks
 * `/openapi.json` in production (see backend/main.py) because the auto-generated
 * spec leaks the entire admin / internal route tree. This module is the
 * customer-facing replacement: serves the `/v1/*` surface only.
 *
 * Served by:
 *   - GET /api/openapi               (Next.js route)
 *   - GET /.well-known/openapi.json  (Stripe / Twilio convention; rewritten in next.config.ts)
 *   - GET /openapi.json              (Vercel / agent convention; rewritten in next.config.ts)
 *
 * Pricing context for callers: see lib/pricing/tiers.ts (METERED_RATES,
 * SUBSCRIPTION_TIERS) — credit costs and tier limits are mirrored in
 * this spec's `description` fields, not embedded as machine schema (so we
 * don't have a second source of pricing truth that can drift).
 *
 * Stability: this is a public contract. Bump `info.version` on any breaking
 * change. Additive (new endpoint, new optional field) does not require a bump.
 */

// Minimal structural type — we don't pull in `openapi-types` so the package
// list stays unchanged. The spec is verified to parse via `JSON.parse(JSON.stringify(spec))`
// in the route handler, and lint is provided by hand-review.
export type OpenApiV31Spec = {
  openapi: "3.1.0";
  info: Record<string, unknown>;
  servers: ReadonlyArray<Record<string, unknown>>;
  security: ReadonlyArray<Record<string, ReadonlyArray<string>>>;
  tags: ReadonlyArray<Record<string, unknown>>;
  paths: Record<string, Record<string, unknown>>;
  components: {
    securitySchemes: Record<string, unknown>;
    schemas: Record<string, unknown>;
    responses: Record<string, unknown>;
    parameters: Record<string, unknown>;
  };
  // Vendor extensions — Redoc + agent-readable.
  "x-logo": Record<string, unknown>;
  "x-mcp-server": Record<string, unknown>;
};

// ─── Reusable error envelope (consistent across every /v1/* route) ───────────

const ApiErrorSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message", "type"],
      properties: {
        code: {
          type: "string",
          description:
            "Stable machine-readable error code (e.g. INVALID_API_KEY, INSUFFICIENT_CREDITS).",
          examples: ["INVALID_API_KEY"],
        },
        message: {
          type: "string",
          description: "Human-readable explanation. May include suggestions or examples.",
        },
        type: {
          type: "string",
          enum: [
            "authentication_error",
            "authorization_error",
            "validation_error",
            "rate_limit_error",
            "billing_error",
            "not_found_error",
            "server_error",
          ],
        },
        request_id: {
          type: "string",
          description: "Server-assigned correlation ID. Include in support requests.",
          examples: ["req_a1b2c3d4e5f6"],
        },
      },
    },
  },
} as const;

const errorResponse = (description: string, code: string) => ({
  description,
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ApiError" },
      example: {
        error: {
          code,
          message: "An error occurred. See `code` for details.",
          type: "validation_error",
          request_id: "req_a1b2c3d4e5f6",
        },
      },
    },
  },
});

// ─── Schemas ─────────────────────────────────────────────────────────────────

const schemas = {
  ApiError: ApiErrorSchema,

  // Predict
  ActionResponse: {
    type: "object",
    required: ["action_type"],
    properties: {
      action_type: {
        type: "string",
        enum: [
          "click", "type_text", "key_press", "key_combo",
          "scroll", "drag", "move", "wait", "done", "fail",
        ],
      },
      params: { type: "object", additionalProperties: true },
      description: { type: "string" },
      raw_code: { type: "string" },
    },
  },
  UsageInfo: {
    type: "object",
    properties: {
      input_tokens: { type: "integer", default: 0 },
      output_tokens: { type: "integer", default: 0 },
      credits_charged: { type: "integer", default: 0 },
    },
  },
  TrajectoryStep: {
    type: "object",
    required: ["screenshot"],
    properties: {
      screenshot: { type: "string", description: "Base64-encoded PNG/JPEG screenshot." },
      actions: { type: "array", items: { $ref: "#/components/schemas/ActionResponse" } },
      reasoning: { type: "string" },
    },
  },
  PredictRequest: {
    type: "object",
    required: ["screenshot", "instruction"],
    properties: {
      screenshot: {
        type: "string",
        description: "Base64-encoded PNG/JPEG screenshot. Min 100 chars.",
      },
      instruction: {
        type: "string",
        minLength: 1,
        description: "Natural-language task instruction.",
      },
      cua_version: {
        type: "string",
        enum: ["v1", "v3"],
        default: "v3",
        description:
          "v1 = baseline (single action, reflection, 8-step trajectory, 9-10s). v3 = lean (multi-action, no reflection, 3.5-4s).",
      },
      model: { type: "string", nullable: true },
      system_prompt: { type: "string", nullable: true },
      screen_width: { type: "integer", minimum: 320, maximum: 3840, default: 1920 },
      screen_height: { type: "integer", minimum: 240, maximum: 2160, default: 1080 },
      trajectory: { type: "array", items: { $ref: "#/components/schemas/TrajectoryStep" } },
      max_actions: { type: "integer", minimum: 1, maximum: 10, default: 5 },
      tools: { type: "array", items: { type: "string" }, nullable: true },
      include_reasoning: { type: "boolean", default: true },
      include_raw_code: { type: "boolean", default: true },
    },
  },
  PredictResponse: {
    type: "object",
    required: ["request_id", "actions", "status", "usage"],
    properties: {
      request_id: { type: "string" },
      actions: { type: "array", items: { $ref: "#/components/schemas/ActionResponse" } },
      raw_code: { type: "array", items: { type: "string" } },
      reasoning: { type: "string" },
      status: { type: "string", enum: ["continue", "done", "fail"] },
      usage: { $ref: "#/components/schemas/UsageInfo" },
    },
  },

  // Sessions
  CreateSessionRequest: {
    type: "object",
    properties: {
      cua_version: { type: "string", enum: ["v1", "v3"], default: "v3" },
      model: { type: "string", nullable: true },
      screen_width: { type: "integer", minimum: 320, maximum: 3840, default: 1920 },
      screen_height: { type: "integer", minimum: 240, maximum: 2160, default: 1080 },
      max_trajectory_length: { type: "integer", minimum: 1, maximum: 20, default: 3 },
      system_prompt: { type: "string", nullable: true },
      tools: { type: "array", items: { type: "string" }, nullable: true },
      metadata: { type: "object", additionalProperties: true, nullable: true },
    },
  },
  CreateSessionResponse: {
    type: "object",
    required: ["session_id", "cua_version", "model", "screen_size", "created_at", "expires_at"],
    properties: {
      session_id: { type: "string" },
      cua_version: { type: "string" },
      model: { type: "string" },
      screen_size: { type: "string", examples: ["1920x1080"] },
      created_at: { type: "string", format: "date-time" },
      expires_at: { type: "string", format: "date-time" },
    },
  },
  SessionPredictRequest: {
    type: "object",
    required: ["screenshot", "instruction"],
    properties: {
      screenshot: { type: "string" },
      instruction: { type: "string", minLength: 1 },
      include_reasoning: { type: "boolean", default: true },
      include_raw_code: { type: "boolean", default: true },
    },
  },
  SessionPredictResponse: {
    type: "object",
    required: ["request_id", "session_id", "step", "actions", "status", "usage"],
    properties: {
      request_id: { type: "string" },
      session_id: { type: "string" },
      step: { type: "integer" },
      actions: { type: "array", items: { $ref: "#/components/schemas/ActionResponse" } },
      raw_code: { type: "array", items: { type: "string" } },
      reasoning: { type: "string" },
      status: { type: "string", enum: ["continue", "done", "fail"] },
      usage: { $ref: "#/components/schemas/UsageInfo" },
    },
  },
  SessionInfoResponse: {
    type: "object",
    required: ["session_id", "cua_version", "model", "screen_size", "created_at", "expires_at"],
    properties: {
      session_id: { type: "string" },
      cua_version: { type: "string" },
      model: { type: "string" },
      screen_size: { type: "string" },
      step_count: { type: "integer", default: 0 },
      created_at: { type: "string", format: "date-time" },
      expires_at: { type: "string", format: "date-time" },
      total_credits_used: { type: "integer", default: 0 },
    },
  },

  // Ground / OCR / Parse
  GroundRequest: {
    type: "object",
    required: ["screenshot", "element"],
    properties: {
      screenshot: { type: "string" },
      element: { type: "string", description: "Natural-language description of the UI element." },
      screen_width: { type: "integer", minimum: 320, maximum: 3840, default: 1920 },
      screen_height: { type: "integer", minimum: 240, maximum: 2160, default: 1080 },
    },
  },
  GroundResponse: {
    type: "object",
    required: ["x", "y", "usage"],
    properties: {
      x: { type: "integer" },
      y: { type: "integer" },
      usage: { $ref: "#/components/schemas/UsageInfo" },
    },
  },
  OCRRequest: {
    type: "object",
    required: ["screenshot"],
    properties: {
      screenshot: { type: "string" },
      region: {
        type: "object",
        nullable: true,
        properties: {
          x: { type: "integer" },
          y: { type: "integer" },
          width: { type: "integer" },
          height: { type: "integer" },
        },
      },
    },
  },
  OCRElement: {
    type: "object",
    required: ["id", "text", "left", "top", "width", "height"],
    properties: {
      id: { type: "integer" },
      text: { type: "string" },
      left: { type: "integer" },
      top: { type: "integer" },
      width: { type: "integer" },
      height: { type: "integer" },
    },
  },
  OCRResponse: {
    type: "object",
    required: ["elements", "full_text", "usage"],
    properties: {
      elements: { type: "array", items: { $ref: "#/components/schemas/OCRElement" } },
      full_text: { type: "string" },
      usage: { $ref: "#/components/schemas/UsageInfo" },
    },
  },
  ParseRequest: {
    type: "object",
    required: ["code"],
    properties: {
      code: { type: "string", maxLength: 50000, description: "Raw pyautogui code." },
    },
  },
  ParseResponse: {
    type: "object",
    required: ["actions"],
    properties: {
      actions: { type: "array", items: { $ref: "#/components/schemas/ActionResponse" } },
    },
  },

  // Models / Usage / Keys
  ModelInfo: {
    type: "object",
    required: ["id", "description"],
    properties: { id: { type: "string" }, description: { type: "string" } },
  },
  CUAVersionInfo: {
    type: "object",
    required: ["id", "description", "avg_step_time", "features"],
    properties: {
      id: { type: "string" },
      description: { type: "string" },
      avg_step_time: { type: "string" },
      features: { type: "array", items: { type: "string" } },
    },
  },
  ModelsResponse: {
    type: "object",
    required: ["models", "cua_versions", "action_types"],
    properties: {
      models: { type: "array", items: { $ref: "#/components/schemas/ModelInfo" } },
      cua_versions: { type: "array", items: { $ref: "#/components/schemas/CUAVersionInfo" } },
      action_types: { type: "array", items: { type: "string" } },
    },
  },
  EndpointUsage: {
    type: "object",
    properties: {
      requests: { type: "integer", default: 0 },
      credits: { type: "integer", default: 0 },
    },
  },
  UsageSummaryResponse: {
    type: "object",
    required: ["period"],
    properties: {
      period: { type: "string" },
      total_requests: { type: "integer", default: 0 },
      total_credits: { type: "integer", default: 0 },
      breakdown: {
        type: "object",
        additionalProperties: { $ref: "#/components/schemas/EndpointUsage" },
      },
      balance: { type: "integer", default: 0 },
    },
  },
  CreateAPIKeyRequest: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 100 },
      scopes: {
        type: "array",
        items: { type: "string" },
        default: ["predict", "session", "ground", "ocr", "parse"],
        description:
          "CUA scopes. Valid: predict, session, ground, ocr, parse. Machine/schedule scopes are assigned by tier.",
      },
    },
  },
  APIKeyResponse: {
    type: "object",
    required: ["key", "key_id", "name", "tier", "scopes", "created_at"],
    properties: {
      key: { type: "string", description: "The raw API key. Returned ONCE only." },
      key_id: { type: "string" },
      name: { type: "string" },
      tier: { type: "string", enum: ["free", "starter", "professional", "enterprise"] },
      scopes: { type: "array", items: { type: "string" } },
      created_at: { type: "string", format: "date-time" },
    },
  },
  APIKeyListItem: {
    type: "object",
    required: ["key_id", "name", "tier", "scopes", "created_at", "key_prefix"],
    properties: {
      key_id: { type: "string" },
      name: { type: "string" },
      tier: { type: "string" },
      scopes: { type: "array", items: { type: "string" } },
      created_at: { type: "string", format: "date-time" },
      last_used_at: { type: "string", format: "date-time", nullable: true },
      key_prefix: { type: "string", description: "First 8 characters of the key." },
    },
  },

  // Machines
  MachineRecord: {
    type: "object",
    required: ["id", "display_name", "status", "provider"],
    properties: {
      id: { type: "string" },
      display_name: { type: "string" },
      status: { type: "string", enum: ["provisioning", "running", "stopped", "terminated", "error"] },
      os_type: { type: "string", enum: ["linux", "windows"], default: "linux" },
      provider: { type: "string", enum: ["aws", "azure", "auto"] },
      desktop_enabled: { type: "boolean", default: false },
      cpu_cores: { type: "integer", default: 1 },
      memory_gb: { type: "number", default: 2.0 },
      storage_gb: { type: "integer", default: 10 },
      public_ip: { type: "string", nullable: true },
      is_test: { type: "boolean", default: false },
      created_at: { type: "string", format: "date-time", nullable: true },
      started_at: { type: "string", format: "date-time", nullable: true },
      metadata: { type: "object", additionalProperties: { type: "string" } },
    },
  },
  ConnectionDetailsRedacted: {
    type: "object",
    properties: {
      public_ip: { type: "string", nullable: true },
      ssh_port: { type: "integer", nullable: true },
      ssh_username: { type: "string", nullable: true },
      vnc_port: { type: "integer", nullable: true },
      websocket_port: { type: "integer", nullable: true },
      has_ssh_key: { type: "boolean", default: false },
      has_vnc_password: { type: "boolean", default: false },
    },
  },
  ConnectionDetailsFull: {
    type: "object",
    required: ["machine_id", "request_id"],
    properties: {
      machine_id: { type: "string" },
      public_ip: { type: "string", nullable: true },
      ssh_port: { type: "integer", nullable: true },
      ssh_username: { type: "string", nullable: true },
      ssh_private_key_pem: {
        type: "string",
        nullable: true,
        description:
          "ED25519 (Linux) or RSA (Windows) private key. HIGHLY SENSITIVE — store in a secrets manager.",
      },
      vnc_port: { type: "integer", nullable: true },
      vnc_password: { type: "string", nullable: true },
      websocket_port: { type: "integer", nullable: true },
      websocket_url: { type: "string", nullable: true },
      devtools_url: { type: "string", nullable: true },
      request_id: { type: "string" },
    },
  },
  ProvisionRequest: {
    type: "object",
    required: ["display_name"],
    additionalProperties: false,
    properties: {
      display_name: { type: "string", minLength: 1, maxLength: 64 },
      provider: { type: "string", enum: ["aws", "azure", "auto"], default: "auto" },
      os_type: { type: "string", enum: ["linux", "windows"], default: "linux" },
      desktop_enabled: { type: "boolean", default: false },
      cpu_cores: { type: "integer", minimum: 1, maximum: 16, nullable: true },
      memory_gb: { type: "integer", minimum: 1, maximum: 64, nullable: true },
      storage_gb: { type: "integer", minimum: 8, maximum: 500, nullable: true },
      restore_from_snapshot: { type: "boolean", default: false, nullable: true },
      metadata: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "Max 16 entries; keys ≤64 chars, values ≤256 chars.",
      },
    },
  },
  ProvisionResponse: {
    type: "object",
    required: ["machine", "connection", "request_id"],
    properties: {
      machine: { $ref: "#/components/schemas/MachineRecord" },
      connection: { $ref: "#/components/schemas/ConnectionDetailsRedacted" },
      request_id: { type: "string" },
    },
  },
  ListMachinesResponse: {
    type: "object",
    required: ["data", "request_id"],
    properties: {
      data: { type: "array", items: { $ref: "#/components/schemas/MachineRecord" } },
      has_more: { type: "boolean", default: false },
      request_id: { type: "string" },
    },
  },
  GetMachineResponse: {
    type: "object",
    required: ["machine", "request_id"],
    properties: {
      machine: { $ref: "#/components/schemas/MachineRecord" },
      request_id: { type: "string" },
    },
  },
  LifecycleResponse: {
    type: "object",
    required: ["machine_id", "status", "message", "request_id"],
    properties: {
      machine_id: { type: "string" },
      status: { type: "string" },
      message: { type: "string" },
      request_id: { type: "string" },
    },
  },
  SnapshotResponse: {
    type: "object",
    required: ["machine_id", "snapshot_id", "name", "created_at", "credits_charged", "request_id"],
    properties: {
      machine_id: { type: "string" },
      snapshot_id: { type: "string" },
      name: { type: "string" },
      created_at: { type: "string", format: "date-time" },
      credits_charged: { type: "integer" },
      request_id: { type: "string" },
    },
  },
  ScreenshotResponse: {
    type: "object",
    required: ["machine_id", "image_b64", "mime_type", "width", "height", "captured_at", "request_id"],
    properties: {
      machine_id: { type: "string" },
      image_b64: { type: "string", description: "Base64-encoded screenshot (no data: prefix)." },
      mime_type: { type: "string", default: "image/jpeg" },
      width: { type: "integer" },
      height: { type: "integer" },
      captured_at: { type: "string", format: "date-time" },
      request_id: { type: "string" },
    },
  },
  ActionRequest: {
    type: "object",
    required: ["command"],
    additionalProperties: false,
    properties: {
      command: {
        type: "string",
        minLength: 1,
        maxLength: 64,
        description:
          "Canonical command name. See /v1/cua/models for the full action allowlist (click, type, screenshot, terminal_execute, file_read, browser_open, etc.).",
      },
      parameters: {
        type: "object",
        additionalProperties: true,
        description: "Command-specific params (e.g. {x, y} for click). Max 1 MB serialized.",
      },
      timeout_ms: { type: "integer", minimum: 1000, maximum: 120000, nullable: true },
    },
  },
  ActionResultResponse: {
    type: "object",
    required: ["machine_id", "command", "success", "duration_ms", "request_id"],
    properties: {
      machine_id: { type: "string" },
      command: { type: "string" },
      success: { type: "boolean" },
      result: { type: "object", additionalProperties: true, nullable: true },
      error: { type: "string", nullable: true },
      duration_ms: { type: "integer" },
      screenshot: {
        type: "string",
        nullable: true,
        description: "Auto-captured post-action screenshot for browser_* commands. Data URI base64.",
      },
      request_id: { type: "string" },
    },
  },
  BatchActionRequest: {
    type: "object",
    required: ["steps"],
    additionalProperties: false,
    properties: {
      steps: {
        type: "array",
        minItems: 1,
        maxItems: 50,
        items: { $ref: "#/components/schemas/ActionRequest" },
      },
      stop_on_error: { type: "boolean", default: true },
    },
  },
  BatchActionResponse: {
    type: "object",
    required: ["machine_id", "results", "completed_count", "failed_count", "request_id"],
    properties: {
      machine_id: { type: "string" },
      results: { type: "array", items: { $ref: "#/components/schemas/ActionResultResponse" } },
      completed_count: { type: "integer" },
      failed_count: { type: "integer" },
      aborted: { type: "boolean", default: false },
      request_id: { type: "string" },
    },
  },
  BrowserOpRequest: {
    type: "object",
    additionalProperties: false,
    properties: {
      parameters: { type: "object", additionalProperties: true },
      timeout_ms: { type: "integer", minimum: 1000, maximum: 120000, nullable: true },
    },
  },
  TerminalRequest: {
    type: "object",
    required: ["command"],
    additionalProperties: false,
    properties: {
      command: { type: "string", minLength: 1, maxLength: 8192 },
      timeout_ms: { type: "integer", minimum: 1000, maximum: 120000, default: 30000 },
      session_id: { type: "string", maxLength: 128, nullable: true },
      cwd: { type: "string", maxLength: 512, nullable: true },
    },
  },
  FilesOpRequest: {
    type: "object",
    additionalProperties: false,
    properties: {
      parameters: {
        type: "object",
        additionalProperties: true,
        description: "Op-specific params: {path} for read; {path, content} for write; etc.",
      },
    },
  },

  // Schedules
  ScheduleResponse: {
    type: "object",
    required: ["id", "name", "machine_id", "task_prompt", "enabled", "frequency", "cron", "timezone"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      machine_id: { type: "string" },
      task_prompt: { type: "string" },
      enabled: { type: "boolean" },
      frequency: { type: "string" },
      cron: { type: "string" },
      timezone: { type: "string" },
      next_run_at: { type: "string", format: "date-time", nullable: true },
      last_run_at: { type: "string", format: "date-time", nullable: true },
      run_count: { type: "integer", default: 0 },
      consecutive_failures: { type: "integer", default: 0 },
      paused_reason: { type: "string", nullable: true },
      is_test: { type: "boolean", default: false },
      created_at: { type: "string", format: "date-time", nullable: true },
      metadata: { type: "object", additionalProperties: { type: "string" } },
    },
  },
  ScheduleCreateRequest: {
    type: "object",
    required: ["name", "machine_id", "task_prompt"],
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 1, maxLength: 128 },
      machine_id: { type: "string", minLength: 1, maxLength: 64 },
      task_prompt: { type: "string", minLength: 1, maxLength: 8000 },
      frequency: {
        type: "string",
        enum: [
          "every_15_minutes", "every_30_minutes", "hourly",
          "every_6_hours", "every_12_hours",
          "daily", "weekly", "monthly", "custom",
        ],
        nullable: true,
      },
      cron: {
        type: "string",
        maxLength: 128,
        nullable: true,
        description: "Required when frequency='custom'. 5- or 6-field cron expression.",
      },
      timezone: { type: "string", maxLength: 64, default: "UTC" },
      time: {
        type: "string",
        maxLength: 5,
        nullable: true,
        description: "HH:MM 24-hour. Used by daily/weekly/monthly presets.",
      },
      day_of_week: { type: "integer", minimum: 0, maximum: 6, nullable: true },
      day_of_month: { type: "integer", minimum: 1, maximum: 28, nullable: true },
      run_at: {
        type: "string",
        format: "date-time",
        nullable: true,
        description: "ISO 8601 UTC timestamp for a one-shot schedule. Mutually exclusive with frequency.",
      },
      max_consecutive_failures: { type: "integer", minimum: 1, maximum: 50, default: 5 },
      metadata: { type: "object", additionalProperties: { type: "string" } },
    },
  },
  ScheduleUpdateRequest: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 1, maxLength: 128 },
      task_prompt: { type: "string", minLength: 1, maxLength: 8000 },
      frequency: { type: "string" },
      cron: { type: "string", maxLength: 128 },
      timezone: { type: "string", maxLength: 64 },
      time: { type: "string", maxLength: 5 },
      day_of_week: { type: "integer", minimum: 0, maximum: 6 },
      day_of_month: { type: "integer", minimum: 1, maximum: 28 },
      max_consecutive_failures: { type: "integer", minimum: 1, maximum: 50 },
      enabled: { type: "boolean" },
      metadata: { type: "object", additionalProperties: { type: "string" } },
    },
  },
  ListSchedulesResponse: {
    type: "object",
    required: ["data", "request_id"],
    properties: {
      data: { type: "array", items: { $ref: "#/components/schemas/ScheduleResponse" } },
      has_more: { type: "boolean", default: false },
      request_id: { type: "string" },
    },
  },
  ScheduleRunRecord: {
    type: "object",
    required: ["id", "schedule_id", "status", "trigger", "executed_at"],
    properties: {
      id: { type: "string" },
      schedule_id: { type: "string" },
      status: {
        type: "string",
        enum: ["completed", "failed", "skipped", "cancelled", "running", "insufficient_credits"],
      },
      trigger: { type: "string", enum: ["cron", "manual", "triggered", "webhook", "email", "run_at"] },
      duration_seconds: { type: "integer", nullable: true },
      credits_charged: { type: "integer", nullable: true },
      error: { type: "string", nullable: true },
      executed_at: { type: "string", format: "date-time" },
    },
  },
  ListRunsResponse: {
    type: "object",
    required: ["data", "request_id"],
    properties: {
      data: { type: "array", items: { $ref: "#/components/schemas/ScheduleRunRecord" } },
      next_cursor: { type: "string", nullable: true },
      has_more: { type: "boolean", default: false },
      request_id: { type: "string" },
    },
  },
  RunScheduleRequest: {
    type: "object",
    additionalProperties: false,
    properties: {
      task_prompt_override: { type: "string", maxLength: 8000, nullable: true },
      triggered_context: {
        type: "object",
        additionalProperties: true,
        nullable: true,
        description: "Free-form context injected into the agent's prompt. Max 1 MB serialized.",
      },
    },
  },
  RunScheduleResponse: {
    type: "object",
    required: ["schedule_id", "run_id", "status", "message", "request_id"],
    properties: {
      schedule_id: { type: "string" },
      run_id: { type: "string" },
      status: { type: "string", enum: ["running", "queued", "skipped"] },
      message: { type: "string" },
      request_id: { type: "string" },
    },
  },

  // Triggers
  TriggerCreateRequest: {
    type: "object",
    required: ["kind"],
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["webhook", "email", "chain"] },
      source_schedule_id: { type: "string", maxLength: 64, nullable: true },
      event: { type: "string", enum: ["on_complete", "on_failure", "on_any"], default: "on_complete" },
      pass_output: { type: "boolean", default: true },
      rate_limit_per_minute: { type: "integer", minimum: 1, maximum: 600, default: 60 },
      email_label: { type: "string", maxLength: 64, nullable: true },
      enabled: { type: "boolean", default: true },
    },
  },
  TriggerResponse: {
    type: "object",
    required: ["id", "schedule_id", "kind", "enabled", "created_at"],
    properties: {
      id: { type: "string" },
      schedule_id: { type: "string" },
      kind: { type: "string", enum: ["webhook", "email", "chain"] },
      enabled: { type: "boolean" },
      created_at: { type: "string", format: "date-time" },
      webhook_url: { type: "string", nullable: true },
      webhook_secret: {
        type: "string",
        nullable: true,
        description: "HMAC secret. Returned ONCE at creation. Server stores only the hash.",
      },
      email_address: { type: "string", nullable: true },
      source_schedule_id: { type: "string", nullable: true },
      event: { type: "string", nullable: true },
    },
  },
  ListTriggersResponse: {
    type: "object",
    required: ["data", "request_id"],
    properties: {
      data: { type: "array", items: { $ref: "#/components/schemas/TriggerResponse" } },
      request_id: { type: "string" },
    },
  },
  WebhookFireResponse: {
    type: "object",
    required: ["received", "schedule_id", "message", "request_id"],
    properties: {
      received: { type: "boolean" },
      schedule_id: { type: "string" },
      run_id: { type: "string", nullable: true },
      deduplicated: { type: "boolean", default: false },
      message: { type: "string" },
      request_id: { type: "string" },
    },
  },
  EmailMailboxResponse: {
    type: "object",
    required: ["email_address", "label", "is_test", "request_id"],
    properties: {
      email_address: { type: "string", format: "email" },
      label: { type: "string" },
      is_test: { type: "boolean" },
      note: { type: "string" },
      request_id: { type: "string" },
    },
  },
  HealthResponse: {
    type: "object",
    required: ["status"],
    properties: {
      status: { type: "string", enum: ["ok"] },
      api_version: { type: "string" },
      service: { type: "string" },
    },
  },
} as const;

// ─── Reusable parameters ─────────────────────────────────────────────────────

const parameters = {
  IdempotencyKey: {
    name: "Idempotency-Key",
    in: "header",
    required: false,
    description:
      "Optional client-supplied key (≤128 chars, [A-Za-z0-9_-:]) for safe retries. Replays the original response for 24 h when the body hash matches; returns 422 IDEMPOTENCY_KEY_REUSED if the body differs.",
    schema: { type: "string", maxLength: 128, pattern: "^[A-Za-z0-9_\\-:]+$" },
    examples: { uuid: { value: "550e8400-e29b-41d4-a716-446655440000" } },
  },
  MachineId: {
    name: "machine_id",
    in: "path",
    required: true,
    description: "Machine UUID, or `mch_test_<8 hex>` for sandbox/test-mode keys.",
    schema: { type: "string" },
  },
  ScheduleId: {
    name: "schedule_id",
    in: "path",
    required: true,
    description: "Schedule UUID, or `sch_test_<8 hex>` for sandbox keys.",
    schema: { type: "string" },
  },
  TriggerId: {
    name: "trigger_id",
    in: "path",
    required: true,
    schema: { type: "string", pattern: "^trg_[0-9a-f]{8,32}$" },
  },
  WebhookId: {
    name: "webhook_id",
    in: "path",
    required: true,
    schema: { type: "string", pattern: "^whk_[0-9a-f]{8,48}$" },
  },
  SessionId: {
    name: "session_id",
    in: "path",
    required: true,
    schema: { type: "string" },
  },
} as const;

// ─── Reusable responses ──────────────────────────────────────────────────────

const responses = {
  BadRequest: errorResponse("Invalid request body or parameters.", "VALIDATION_ERROR"),
  Unauthorized: errorResponse(
    "Missing, invalid, or revoked API key. Pass `X-API-Key: sk-coasty-live-...` (or test).",
    "INVALID_API_KEY",
  ),
  Forbidden: errorResponse(
    "API key lacks the required scope or tier-feature is unavailable on the caller's plan.",
    "INSUFFICIENT_SCOPE",
  ),
  NotFound: errorResponse("Resource not found in this key's namespace.", "NOT_FOUND"),
  RateLimited: errorResponse(
    "Per-minute or per-hour rate limit exceeded. Inspect the X-RateLimit-Reset header.",
    "RATE_LIMIT_EXCEEDED",
  ),
  PaymentRequired: errorResponse(
    "Insufficient credits to perform the operation. Top up via /credits or upgrade subscription.",
    "INSUFFICIENT_CREDITS",
  ),
  ServerError: errorResponse("Unexpected server error. Retry with exponential backoff.", "INTERNAL_ERROR"),
} as const;

// ─── Path helpers ────────────────────────────────────────────────────────────

const standardErrors = {
  "400": { $ref: "#/components/responses/BadRequest" },
  "401": { $ref: "#/components/responses/Unauthorized" },
  "403": { $ref: "#/components/responses/Forbidden" },
  "404": { $ref: "#/components/responses/NotFound" },
  "429": { $ref: "#/components/responses/RateLimited" },
  "500": { $ref: "#/components/responses/ServerError" },
};

const billedErrors = {
  ...standardErrors,
  "402": { $ref: "#/components/responses/PaymentRequired" },
};

// ─── Paths ───────────────────────────────────────────────────────────────────

const paths = {
  // ── Predict ──
  "/v1/predict": {
    post: {
      tags: ["predict"],
      operationId: "predict",
      summary: "Stateless action prediction",
      description:
        "Send a screenshot + instruction; receive a list of structured actions to execute on the target machine. Costs ~5 credits/call (varies by CUA version, screenshot size, trajectory length). See lib/pricing/tiers.ts METERED_RATES for budgeting.",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/PredictRequest" },
            example: {
              screenshot: "<base64-png>",
              instruction: "Click the Sign In button",
              cua_version: "v3",
              screen_width: 1920,
              screen_height: 1080,
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Predicted actions.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/PredictResponse" } },
          },
        },
        ...billedErrors,
      },
    },
  },

  // ── Sessions ──
  "/v1/sessions": {
    post: {
      tags: ["sessions"],
      operationId: "createSession",
      summary: "Create a stateful CUA session",
      description: "Persistent session (~5-15 min idle TTL). Maintains trajectory across predictions. Concurrent-session limit varies by tier (free: 1, pro: 10).",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/CreateSessionRequest" } },
        },
      },
      responses: {
        "200": {
          description: "Session created.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/CreateSessionResponse" } },
          },
        },
        ...billedErrors,
      },
    },
    get: {
      tags: ["sessions"],
      operationId: "listSessions",
      summary: "List active sessions",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      responses: {
        "200": {
          description: "Active sessions for this key.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  sessions: {
                    type: "array",
                    items: { $ref: "#/components/schemas/SessionInfoResponse" },
                  },
                },
              },
            },
          },
        },
        ...standardErrors,
      },
    },
  },
  "/v1/sessions/{session_id}": {
    parameters: [{ $ref: "#/components/parameters/SessionId" }],
    get: {
      tags: ["sessions"],
      operationId: "getSession",
      summary: "Get session info",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      responses: {
        "200": {
          description: "Session info.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/SessionInfoResponse" } },
          },
        },
        ...standardErrors,
      },
    },
    delete: {
      tags: ["sessions"],
      operationId: "deleteSession",
      summary: "Delete a session",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      responses: {
        "200": {
          description: "Deleted.",
          content: { "application/json": { schema: { type: "object" } } },
        },
        ...standardErrors,
      },
    },
  },
  "/v1/sessions/{session_id}/predict": {
    parameters: [{ $ref: "#/components/parameters/SessionId" }],
    post: {
      tags: ["sessions"],
      operationId: "sessionPredict",
      summary: "Predict within an existing session",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/SessionPredictRequest" } },
        },
      },
      responses: {
        "200": {
          description: "Predicted actions for the next step.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/SessionPredictResponse" } },
          },
        },
        ...billedErrors,
      },
    },
  },
  "/v1/sessions/{session_id}/reset": {
    parameters: [{ $ref: "#/components/parameters/SessionId" }],
    post: {
      tags: ["sessions"],
      operationId: "resetSession",
      summary: "Reset session state",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      responses: {
        "200": {
          description: "Reset.",
          content: { "application/json": { schema: { type: "object" } } },
        },
        ...standardErrors,
      },
    },
  },

  // ── Ground / OCR / Parse ──
  "/v1/ground": {
    post: {
      tags: ["predict"],
      operationId: "ground",
      summary: "Coordinate grounding",
      description: "Find (x, y) for a described UI element. ~2 credits/call.",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: "#/components/schemas/GroundRequest" } } },
      },
      responses: {
        "200": {
          description: "Grounded coordinates.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/GroundResponse" } } },
        },
        ...billedErrors,
      },
    },
  },
  "/v1/ocr": {
    post: {
      tags: ["predict"],
      operationId: "ocr",
      summary: "OCR a screenshot",
      description: "Extract text + bounding boxes. ~1 credit/call.",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: "#/components/schemas/OCRRequest" } } },
      },
      responses: {
        "200": {
          description: "OCR result.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/OCRResponse" } } },
        },
        ...billedErrors,
      },
    },
  },
  "/v1/parse": {
    post: {
      tags: ["predict"],
      operationId: "parse",
      summary: "Parse pyautogui code into structured actions",
      description: "Free, no LLM call. Returns structured Action objects.",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: "#/components/schemas/ParseRequest" } } },
      },
      responses: {
        "200": {
          description: "Parsed actions.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ParseResponse" } } },
        },
        ...standardErrors,
      },
    },
  },

  // ── Models / Usage ──
  "/v1/models": {
    get: {
      tags: ["predict"],
      operationId: "listModels",
      summary: "List available models, CUA versions, and action types",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      responses: {
        "200": {
          description: "Model catalog.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ModelsResponse" } } },
        },
        ...standardErrors,
      },
    },
  },
  "/v1/usage": {
    get: {
      tags: ["keys"],
      operationId: "getUsage",
      summary: "Usage summary for a billing period",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      parameters: [
        {
          name: "period",
          in: "query",
          required: false,
          schema: { type: "string", description: "ISO YYYY-MM (defaults to current month)." },
        },
      ],
      responses: {
        "200": {
          description: "Usage summary.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/UsageSummaryResponse" } },
          },
        },
        ...standardErrors,
      },
    },
  },

  // ── Keys ──
  "/v1/keys": {
    post: {
      tags: ["keys"],
      operationId: "createApiKey",
      summary: "Create an API key",
      description: "Returns the raw key ONCE. Subsequent reads only return the prefix.",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/CreateAPIKeyRequest" } },
        },
      },
      responses: {
        "200": {
          description: "Key created.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/APIKeyResponse" } },
          },
        },
        ...standardErrors,
      },
    },
    get: {
      tags: ["keys"],
      operationId: "listApiKeys",
      summary: "List API keys",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      responses: {
        "200": {
          description: "Keys.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  keys: {
                    type: "array",
                    items: { $ref: "#/components/schemas/APIKeyListItem" },
                  },
                },
              },
            },
          },
        },
        ...standardErrors,
      },
    },
  },
  "/v1/keys/{key_id}": {
    parameters: [
      { name: "key_id", in: "path", required: true, schema: { type: "string" } },
    ],
    delete: {
      tags: ["keys"],
      operationId: "revokeApiKey",
      summary: "Revoke an API key",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      responses: {
        "200": {
          description: "Revoked.",
          content: { "application/json": { schema: { type: "object" } } },
        },
        ...standardErrors,
      },
    },
  },

  // ── Health ──
  "/v1/health": {
    get: {
      tags: ["predict"],
      operationId: "health",
      summary: "Public CUA API health check",
      description: "No authentication required.",
      responses: {
        "200": {
          description: "OK.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/HealthResponse" } } },
        },
      },
    },
  },

  // ── Machines ──
  "/v1/machines": {
    post: {
      tags: ["machines"],
      operationId: "provisionMachine",
      summary: "Provision a new VM",
      description:
        "AWS or Azure VM provisioning. Linux defaults are cheap (1 cpu / 2 GB / 10 GB) and bill at agent-minute rates. Test keys (sk-coasty-test-*) return mock VMs with no AWS calls.",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/ProvisionRequest" } },
        },
      },
      responses: {
        "200": {
          description: "Machine provisioned (or in-progress).",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ProvisionResponse" } },
          },
        },
        ...billedErrors,
      },
    },
    get: {
      tags: ["machines"],
      operationId: "listMachines",
      summary: "List machines",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      parameters: [
        {
          name: "limit",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        },
      ],
      responses: {
        "200": {
          description: "Machines list.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ListMachinesResponse" } },
          },
        },
        ...standardErrors,
      },
    },
  },
  "/v1/machines/health": {
    get: {
      tags: ["machines"],
      operationId: "machinesHealth",
      summary: "Machines API health check",
      responses: {
        "200": {
          description: "OK.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/HealthResponse" } } },
        },
      },
    },
  },
  "/v1/machines/{machine_id}": {
    parameters: [{ $ref: "#/components/parameters/MachineId" }],
    get: {
      tags: ["machines"],
      operationId: "getMachine",
      summary: "Get machine details",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      responses: {
        "200": {
          description: "Machine.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/GetMachineResponse" } },
          },
        },
        ...standardErrors,
      },
    },
    delete: {
      tags: ["machines"],
      operationId: "terminateMachine",
      summary: "Terminate a machine",
      description: "Irreversible. Stops billing the agent-minute rate.",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      responses: {
        "200": {
          description: "Termination requested.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/LifecycleResponse" } },
          },
        },
        ...standardErrors,
      },
    },
  },
  "/v1/machines/{machine_id}/start": {
    parameters: [{ $ref: "#/components/parameters/MachineId" }],
    post: {
      tags: ["machines"],
      operationId: "startMachine",
      summary: "Start a stopped machine",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      responses: {
        "200": {
          description: "Started.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/LifecycleResponse" } },
          },
        },
        ...standardErrors,
      },
    },
  },
  "/v1/machines/{machine_id}/stop": {
    parameters: [{ $ref: "#/components/parameters/MachineId" }],
    post: {
      tags: ["machines"],
      operationId: "stopMachine",
      summary: "Stop a running machine",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      responses: {
        "200": {
          description: "Stopped.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/LifecycleResponse" } },
          },
        },
        ...standardErrors,
      },
    },
  },
  "/v1/machines/{machine_id}/snapshot": {
    parameters: [{ $ref: "#/components/parameters/MachineId" }],
    post: {
      tags: ["machines"],
      operationId: "snapshotMachine",
      summary: "Snapshot a machine",
      description: "Captures current disk state. Requires `snapshots:write` scope.",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
      responses: {
        "200": {
          description: "Snapshot created.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/SnapshotResponse" } },
          },
        },
        ...billedErrors,
      },
    },
  },
  "/v1/machines/{machine_id}/screenshot": {
    parameters: [{ $ref: "#/components/parameters/MachineId" }],
    get: {
      tags: ["machines"],
      operationId: "getScreenshot",
      summary: "Capture a screenshot of the machine",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      responses: {
        "200": {
          description: "Screenshot.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ScreenshotResponse" } },
          },
        },
        ...standardErrors,
      },
    },
  },
  "/v1/machines/{machine_id}/connection": {
    parameters: [{ $ref: "#/components/parameters/MachineId" }],
    get: {
      tags: ["machines"],
      operationId: "getConnectionDetails",
      summary: "Get SSH key + VNC password (HIGH-RISK)",
      description:
        "Returns plaintext credentials. Gated by `connection:read` scope. Response is `Cache-Control: no-store`. Store credentials in a secrets manager — Coasty cannot re-issue them; rotate by terminating + reprovisioning.",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      responses: {
        "200": {
          description: "Connection details.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ConnectionDetailsFull" } },
          },
        },
        ...standardErrors,
      },
    },
  },
  "/v1/machines/{machine_id}/actions": {
    parameters: [{ $ref: "#/components/parameters/MachineId" }],
    post: {
      tags: ["machines"],
      operationId: "executeAction",
      summary: "Execute a single action on the machine",
      description:
        "Required scope varies by command: terminal_* → `terminal:exec`; file_* → `files:read|write`; browser_execute → `browser:execute`; everything else → `actions:exec`. See /v1/cua/models for the allowlist.",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/ActionRequest" } },
        },
      },
      responses: {
        "200": {
          description: "Action result.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ActionResultResponse" } },
          },
        },
        ...billedErrors,
      },
    },
  },
  "/v1/machines/{machine_id}/actions/batch": {
    parameters: [{ $ref: "#/components/parameters/MachineId" }],
    post: {
      tags: ["machines"],
      operationId: "executeBatch",
      summary: "Execute up to 50 sequential actions",
      description: "Shell `&&`-style semantics: aborts on first failure when `stop_on_error=true` (default).",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/BatchActionRequest" } },
        },
      },
      responses: {
        "200": {
          description: "Per-step results.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/BatchActionResponse" } },
          },
        },
        ...billedErrors,
      },
    },
  },
  "/v1/machines/{machine_id}/browser/{op}": {
    parameters: [
      { $ref: "#/components/parameters/MachineId" },
      {
        name: "op",
        in: "path",
        required: true,
        description: "Browser sub-op. One of: open, navigate, click, type, dom, clickables, state, info, scroll, close, screenshot, wait, list-tabs, open-tab, close-tab, switch-tab.",
        schema: {
          type: "string",
          enum: [
            "open", "navigate", "click", "type", "dom", "clickables",
            "state", "info", "scroll", "close", "screenshot", "wait",
            "list-tabs", "open-tab", "close-tab", "switch-tab",
          ],
        },
      },
    ],
    post: {
      tags: ["machines"],
      operationId: "browserOp",
      summary: "Browser convenience sub-API",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/BrowserOpRequest" } },
        },
      },
      responses: {
        "200": {
          description: "Browser action result.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ActionResultResponse" } },
          },
        },
        ...billedErrors,
      },
    },
  },
  "/v1/machines/{machine_id}/terminal": {
    parameters: [{ $ref: "#/components/parameters/MachineId" }],
    post: {
      tags: ["machines"],
      operationId: "terminalExec",
      summary: "Execute a shell command",
      description: "Output truncated VM-side to 5000 chars. Hard cap 120s (Cloudflare edge timeout). Requires `terminal:exec` scope.",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/TerminalRequest" } },
        },
      },
      responses: {
        "200": {
          description: "Terminal output.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ActionResultResponse" } },
          },
        },
        ...billedErrors,
      },
    },
  },
  "/v1/machines/{machine_id}/files/{op}": {
    parameters: [
      { $ref: "#/components/parameters/MachineId" },
      {
        name: "op",
        in: "path",
        required: true,
        description: "File sub-op. Read scope: read, exists, list, list-directory, download, list-downloads. Write scope: write, edit, append, delete, delete-directory.",
        schema: {
          type: "string",
          enum: [
            "read", "exists", "list", "list-directory", "download", "list-downloads",
            "write", "edit", "append", "delete", "delete-directory",
          ],
        },
      },
    ],
    post: {
      tags: ["machines"],
      operationId: "filesOp",
      summary: "File operations sub-API",
      description: "Read ops require `files:read`; mutating ops require `files:write`. Body capped at 50 MB.",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/FilesOpRequest" } },
        },
      },
      responses: {
        "200": {
          description: "File op result.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ActionResultResponse" } },
          },
        },
        ...billedErrors,
      },
    },
  },

  // ── Schedules ──
  "/v1/schedules": {
    post: {
      tags: ["schedules"],
      operationId: "createSchedule",
      summary: "Create a schedule",
      description: "Cron-based or one-shot (run_at) scheduled task. Per-tier limits: free=3, starter=3, pro=10, enterprise=50 (see lib/pricing/tiers.ts scheduleLimit).",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/ScheduleCreateRequest" } },
        },
      },
      responses: {
        "200": {
          description: "Schedule created.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ScheduleResponse" } },
          },
        },
        ...billedErrors,
      },
    },
    get: {
      tags: ["schedules"],
      operationId: "listSchedules",
      summary: "List schedules",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      parameters: [
        {
          name: "limit",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        },
      ],
      responses: {
        "200": {
          description: "Schedules.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ListSchedulesResponse" } },
          },
        },
        ...standardErrors,
      },
    },
  },
  "/v1/schedules/health": {
    get: {
      tags: ["schedules"],
      operationId: "schedulesHealth",
      summary: "Schedules API health check",
      responses: {
        "200": {
          description: "OK.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/HealthResponse" } } },
        },
      },
    },
  },
  "/v1/schedules/{schedule_id}": {
    parameters: [{ $ref: "#/components/parameters/ScheduleId" }],
    get: {
      tags: ["schedules"],
      operationId: "getSchedule",
      summary: "Get schedule details",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      responses: {
        "200": {
          description: "Schedule.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ScheduleResponse" } },
          },
        },
        ...standardErrors,
      },
    },
    patch: {
      tags: ["schedules"],
      operationId: "updateSchedule",
      summary: "Update a schedule",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/ScheduleUpdateRequest" } },
        },
      },
      responses: {
        "200": {
          description: "Updated.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ScheduleResponse" } },
          },
        },
        ...standardErrors,
      },
    },
    delete: {
      tags: ["schedules"],
      operationId: "deleteSchedule",
      summary: "Delete a schedule",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      responses: {
        "200": {
          description: "Deleted.",
          content: { "application/json": { schema: { type: "object" } } },
        },
        ...standardErrors,
      },
    },
  },
  "/v1/schedules/{schedule_id}/pause": {
    parameters: [{ $ref: "#/components/parameters/ScheduleId" }],
    post: {
      tags: ["schedules"],
      operationId: "pauseSchedule",
      summary: "Pause a schedule",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      responses: {
        "200": {
          description: "Paused.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ScheduleResponse" } },
          },
        },
        ...standardErrors,
      },
    },
  },
  "/v1/schedules/{schedule_id}/resume": {
    parameters: [{ $ref: "#/components/parameters/ScheduleId" }],
    post: {
      tags: ["schedules"],
      operationId: "resumeSchedule",
      summary: "Resume a paused schedule",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      responses: {
        "200": {
          description: "Resumed.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ScheduleResponse" } },
          },
        },
        ...standardErrors,
      },
    },
  },
  "/v1/schedules/{schedule_id}/run": {
    parameters: [{ $ref: "#/components/parameters/ScheduleId" }],
    post: {
      tags: ["schedules"],
      operationId: "runScheduleNow",
      summary: "Trigger a schedule run immediately",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/RunScheduleRequest" } },
        },
      },
      responses: {
        "200": {
          description: "Run queued.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/RunScheduleResponse" } },
          },
        },
        ...billedErrors,
      },
    },
  },
  "/v1/schedules/{schedule_id}/runs": {
    parameters: [{ $ref: "#/components/parameters/ScheduleId" }],
    get: {
      tags: ["schedules"],
      operationId: "listScheduleRuns",
      summary: "List historical runs of a schedule",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      parameters: [
        { name: "cursor", in: "query", required: false, schema: { type: "string" } },
        {
          name: "status",
          in: "query",
          required: false,
          schema: {
            type: "string",
            enum: ["completed", "failed", "skipped", "cancelled", "running", "insufficient_credits"],
          },
        },
        {
          name: "limit",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        },
      ],
      responses: {
        "200": {
          description: "Runs.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ListRunsResponse" } },
          },
        },
        ...standardErrors,
      },
    },
  },
  "/v1/schedules/{schedule_id}/runs/{run_id}": {
    parameters: [
      { $ref: "#/components/parameters/ScheduleId" },
      { name: "run_id", in: "path", required: true, schema: { type: "string", maxLength: 64 } },
    ],
    get: {
      tags: ["schedules"],
      operationId: "getScheduleRun",
      summary: "Get a single run",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      responses: {
        "200": {
          description: "Run.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ScheduleRunRecord" } },
          },
        },
        ...standardErrors,
      },
    },
  },

  // ── Triggers ──
  "/v1/schedules/{schedule_id}/triggers": {
    parameters: [{ $ref: "#/components/parameters/ScheduleId" }],
    get: {
      tags: ["triggers"],
      operationId: "listTriggers",
      summary: "List triggers attached to a schedule",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      responses: {
        "200": {
          description: "Triggers.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ListTriggersResponse" } },
          },
        },
        ...standardErrors,
      },
    },
    post: {
      tags: ["triggers"],
      operationId: "addTrigger",
      summary: "Add a trigger (webhook | email | chain)",
      description: "For `webhook`, the response includes a one-time HMAC `webhook_secret` — store it now or rotate the trigger. Chain triggers support a max depth of 5.",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/TriggerCreateRequest" } },
        },
      },
      responses: {
        "200": {
          description: "Trigger created.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/TriggerResponse" } },
          },
        },
        ...standardErrors,
      },
    },
  },
  "/v1/schedules/{schedule_id}/triggers/{trigger_id}": {
    parameters: [
      { $ref: "#/components/parameters/ScheduleId" },
      { $ref: "#/components/parameters/TriggerId" },
    ],
    delete: {
      tags: ["triggers"],
      operationId: "removeTrigger",
      summary: "Remove a trigger",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      responses: {
        "200": {
          description: "Removed.",
          content: { "application/json": { schema: { type: "object" } } },
        },
        ...standardErrors,
      },
    },
  },

  "/v1/triggers/webhook/{webhook_id}": {
    parameters: [{ $ref: "#/components/parameters/WebhookId" }],
    post: {
      tags: ["triggers"],
      operationId: "fireWebhook",
      summary: "Fire a schedule from an external webhook (UNAUTHENTICATED)",
      description:
        "Public, unauthenticated. Verification: HMAC-SHA256 over `<unix_ts>.<body>` using the secret from trigger creation, sent in `Coasty-Signature: t=<ts>,v1=<sig>`. Replay window 5 minutes. Body capped at 1 MB. Repeated identical (webhook_id, body) within 60s are deduped.",
      security: [],
      parameters: [
        {
          name: "Coasty-Signature",
          in: "header",
          required: true,
          schema: { type: "string", examples: ["t=1714900000,v1=4d2f...e7"] },
        },
      ],
      requestBody: {
        required: false,
        content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
      },
      responses: {
        "200": {
          description: "Webhook accepted.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/WebhookFireResponse" } },
          },
        },
        "400": { $ref: "#/components/responses/BadRequest" },
        "404": { $ref: "#/components/responses/NotFound" },
        "413": errorResponse("Body exceeds 1 MB.", "PAYLOAD_TOO_LARGE"),
        "429": { $ref: "#/components/responses/RateLimited" },
        "500": { $ref: "#/components/responses/ServerError" },
      },
    },
  },
  "/v1/triggers/email-mailbox": {
    post: {
      tags: ["triggers"],
      operationId: "provisionEmailMailbox",
      summary: "Provision an inbound email mailbox",
      description:
        "Returns a freshly-allocated address from agents.coasty.ai. Pair with a chain trigger; full inbound-mail-fires-schedule wiring is on the roadmap.",
      security: [{ apiKey: [] }, { bearerAuth: [] }],
      responses: {
        "200": {
          description: "Mailbox.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/EmailMailboxResponse" } },
          },
        },
        ...standardErrors,
      },
    },
  },
  "/v1/triggers/health": {
    get: {
      tags: ["triggers"],
      operationId: "triggersHealth",
      summary: "Triggers API health check",
      responses: {
        "200": {
          description: "OK.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/HealthResponse" } } },
        },
      },
    },
  },
} as const;

// ─── Spec ────────────────────────────────────────────────────────────────────

export const COASTY_OPENAPI_SPEC: OpenApiV31Spec = {
  openapi: "3.1.0",
  info: {
    title: "Coasty Public API",
    version: "1.0.0",
    summary: "Computer Use Agents, scheduled automation, and managed VMs.",
    description: [
      "# Coasty Public API",
      "",
      "Coasty is a Computer Use Agent (CUA) platform: predict actions from screenshots,",
      "provision managed VMs, and run scheduled automation against them.",
      "",
      "## Authentication",
      "",
      "All endpoints (except `/v1/triggers/webhook/{id}` and `/health`) require an API key.",
      "Pass it as either:",
      "",
      "- `X-API-Key: sk-coasty-live-...` (or `sk-coasty-test-...` for sandbox)",
      "- `Authorization: Bearer sk-coasty-live-...`",
      "",
      "Test-mode keys (`sk-coasty-test-*`) hit the same validation paths as live keys but",
      "return mock VMs / mock action results and never bill credits — ideal for CI.",
      "",
      "## Pricing & budgeting",
      "",
      "Per-call rates (subject to change — see `lib/pricing/tiers.ts METERED_RATES`):",
      "",
      "| Endpoint | Credits |",
      "|---|---|",
      "| `POST /v1/predict` | ~5 |",
      "| `POST /v1/sessions` | 10 |",
      "| `POST /v1/sessions/{id}/predict` | ~3 |",
      "| `POST /v1/ground` | ~2 |",
      "| `POST /v1/ocr` | ~1 |",
      "| `POST /v1/parse` | 0 (free) |",
      "",
      "Long-running CUA jobs orchestrated through the dashboard (not this API) bill at",
      "10 credits/minute with a 20-credit minimum. Subscription tiers (`free | starter |",
      "professional | enterprise`) gate per-call rate limits, concurrent sessions, schedule",
      "counts, and the maximum trajectory length.",
      "",
      "## Errors",
      "",
      "Every error response uses the same envelope:",
      "",
      "```json",
      "{",
      "  \"error\": {",
      "    \"code\": \"INSUFFICIENT_CREDITS\",",
      "    \"message\": \"Need 5, have 2.\",",
      "    \"type\": \"billing_error\",",
      "    \"request_id\": \"req_a1b2c3d4e5f6\"",
      "  }",
      "}",
      "```",
      "",
      "Include the `request_id` in support requests.",
      "",
      "## Idempotency",
      "",
      "Mutating endpoints accept `Idempotency-Key: <≤128 chars of [A-Za-z0-9_-:]>`. Replays",
      "of the same key + identical body return the original response (with",
      "`X-Coasty-Idempotent-Replay: true`) for 24 h. Reusing the key with a different body",
      "is a 422 `IDEMPOTENCY_KEY_REUSED`.",
      "",
      "## Rate limits",
      "",
      "Advisory `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers",
      "appear on every authenticated response. Authoritative limits live in Redis; advisory",
      "values may be stale on multi-replica deploys.",
      "",
      "## SDKs & MCP",
      "",
      "- TypeScript: `npm i @coasty/sdk`",
      "- Python: `pip install coasty`",
      "- MCP server: `npx -y @coasty/mcp` (see `x-mcp-server`)",
      "",
      "## Reference",
      "",
      "Complete (machine-readable) spec is hosted at `/.well-known/openapi.json` and",
      "`/openapi.json` (Stripe / Vercel conventions).",
    ].join("\n"),
    contact: {
      name: "Coasty Developer Support",
      url: "https://coasty.ai/support",
      email: "founders@coasty.ai",
    },
    license: {
      name: "MIT",
      identifier: "MIT",
    },
    termsOfService: "https://coasty.ai/terms",
  },
  servers: [
    { url: "https://coasty.ai", description: "Production" },
    {
      url: "https://coasty.ai",
      description: "Sandbox — use sk-coasty-test-* keys against the same host. No billing, mock VMs.",
    },
  ],
  security: [
    { apiKey: [] },
    { bearerAuth: [] },
  ],
  tags: [
    { name: "predict", description: "Stateless CUA action prediction, grounding, OCR." },
    { name: "sessions", description: "Stateful CUA sessions with persistent trajectory." },
    { name: "machines", description: "Provision and control managed VMs (AWS, Azure)." },
    { name: "schedules", description: "Cron and one-shot scheduled CUA jobs." },
    { name: "triggers", description: "Webhook, email, and chain triggers for schedules." },
    { name: "keys", description: "API key management and usage reporting." },
  ],
  paths: paths as unknown as Record<string, Record<string, unknown>>,
  components: {
    securitySchemes: {
      apiKey: {
        type: "apiKey",
        name: "X-API-Key",
        in: "header",
        description: "Coasty API key. Live: `sk-coasty-live-...`. Sandbox: `sk-coasty-test-...`.",
      },
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "Coasty API key (sk-coasty-{live,test}-...)",
        description: "Equivalent to X-API-Key. Use whichever your client supports.",
      },
    },
    schemas: schemas as unknown as Record<string, unknown>,
    responses: responses as unknown as Record<string, unknown>,
    parameters: parameters as unknown as Record<string, unknown>,
  },
  "x-logo": {
    url: "https://coasty.ai/logo_dark.svg",
    altText: "Coasty",
    backgroundColor: "#FFFFFF",
  },
  "x-mcp-server": {
    name: "@coasty/mcp",
    install: "npx -y @coasty/mcp",
    description:
      "Coasty's Model Context Protocol server. Wires the /v1/* surface plus pricing into any MCP-compatible client (Claude Desktop, Cursor, etc.).",
    homepage: "https://coasty.ai/mcp",
  },
};

/** Endpoint count for sanity-checking + observability. */
export const COASTY_OPENAPI_ENDPOINT_COUNT = Object.values(paths).reduce(
  (n, item) =>
    n +
    Object.keys(item).filter(
      (k) => !["parameters", "summary", "description"].includes(k),
    ).length,
  0,
);
