/**
 * Feature flags — central kill-switches for surfaces we want to keep in
 * the codebase but hide from users.
 *
 * Flip a flag here and redeploy; nothing else needs to change.
 */

/**
 * Gates the entire public/private developer-API surface:
 *   - Landing-nav "API" link → /api-docs
 *   - Mobile drawer "API" row
 *   - In-app sidebar "Developers" entry → /developers
 *   - Guide "API" tab (/guide?tab=api)
 *   - /api-docs page (returns 404 when off)
 *   - /developers page (returns 404 when off)
 *   - /api-docs entry in sitemap.xml
 *
 * The backend `/api/developers` endpoints and the underlying React
 * components are intentionally left in place so re-enabling is a one-line
 * change.
 */
export const DEVELOPERS_API_ENABLED = false
