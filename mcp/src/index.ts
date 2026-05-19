/**
 * Library entrypoint — re-exports the buildServer function so users can embed
 * the MCP server in their own Node host (e.g. for testing, or to wrap the
 * server in custom middleware).
 */

export { buildServer } from "./server.js";
export { CoastyClient } from "./client.js";
export { loadConfig, ConfigError } from "./config.js";
export type { Config } from "./config.js";
export type { CoastyError } from "./errors.js";
