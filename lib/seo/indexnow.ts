/**
 * IndexNow client — pings Bing/Yandex/Naver/Yep when our content changes.
 *
 * Bing alone consumes 5B URLs/day in 2026; Bing also powers ChatGPT search
 * and Microsoft Copilot, so an IndexNow ping translates directly into
 * faster surfacing for two of the three major AI search engines.
 *
 * Usage (call from a deploy hook, Stripe webhook, blog publish, etc.):
 *
 *   import { pingIndexNow } from "@/lib/seo/indexnow"
 *   await pingIndexNow(["https://coasty.ai/blog/new-post-slug"])
 *
 * The key file lives at /public/<INDEXNOW_KEY>.txt — search engines fetch
 * that to verify ownership before consuming the ping.
 *
 * Spec: https://www.indexnow.org/documentation
 * Bing endpoint: https://api.indexnow.org/indexnow
 */

const INDEXNOW_KEY = "1e262d115634d5117e91f39fb579f688"
const HOST = "coasty.ai"

const ENDPOINTS = [
  "https://api.indexnow.org/indexnow",
  // Bing also accepts directly; api.indexnow.org fans out, so one is enough
  // for basic use. Add others here if you observe slow propagation.
] as const

export interface IndexNowPingResult {
  endpoint: string
  status: number
  ok: boolean
  error?: string
}

export async function pingIndexNow(
  urlList: string[],
): Promise<IndexNowPingResult[]> {
  if (urlList.length === 0) return []

  // IndexNow caps at 10 000 URLs per submission. Chunk just in case.
  const chunks: string[][] = []
  for (let i = 0; i < urlList.length; i += 10_000) {
    chunks.push(urlList.slice(i, i + 10_000))
  }

  const results: IndexNowPingResult[] = []
  for (const endpoint of ENDPOINTS) {
    for (const chunk of chunks) {
      const body = {
        host: HOST,
        key: INDEXNOW_KEY,
        keyLocation: `https://${HOST}/${INDEXNOW_KEY}.txt`,
        urlList: chunk,
      }
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify(body),
        })
        results.push({ endpoint, status: res.status, ok: res.ok })
      } catch (err) {
        results.push({
          endpoint,
          status: 0,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
  return results
}

/** Single-URL convenience for blog publish hooks. */
export async function pingIndexNowSingle(url: string): Promise<IndexNowPingResult[]> {
  return pingIndexNow([url])
}
