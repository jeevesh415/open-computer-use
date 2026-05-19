export async function fetchClient(input: RequestInfo, init?: RequestInit) {
  const csrf = document.cookie
    .split("; ")
    .find((c) => c.startsWith("csrf_token="))
    ?.split("=")[1]

  return fetch(input, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "x-csrf-token": csrf || "",
      "Content-Type": "application/json",
    },
  })
}

interface RetryOptions {
  maxRetries?: number
  timeoutMs?: number
  retryDelay?: number
  exponentialBackoff?: boolean
}

// Simple circuit breaker for external API calls
class CircuitBreaker {
  private failureCount = 0
  private lastFailureTime = 0
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED'
  
  constructor(
    private failureThreshold = 5,
    private recoveryTimeout = 30000 // 30 seconds
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.recoveryTimeout) {
        this.state = 'HALF_OPEN'
      } else {
        throw new Error('Circuit breaker is OPEN')
      }
    }

    try {
      const result = await operation()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  private onSuccess() {
    this.failureCount = 0
    this.state = 'CLOSED'
  }

  private onFailure() {
    this.failureCount++
    this.lastFailureTime = Date.now()
    
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN'
    }
  }

  getState() {
    return this.state
  }
}

// Global circuit breaker for user metadata fetching
const userMetadataCircuitBreaker = new CircuitBreaker(3, 60000) // 3 failures, 1 minute recovery

// Exposed for tests so they can assert circuit-state interactions without
// reaching into the singleton via reflection.
export function _getUserMetadataCircuitBreakerState() {
  return userMetadataCircuitBreaker.getState()
}

export async function fetchWithRetry<T>(
  fetchFn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    timeoutMs = 5000,
    retryDelay = 1000,
    exponentialBackoff = true
  } = options

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Add timeout wrapper
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
      )

      const result = await Promise.race([fetchFn(), timeoutPromise])
      return result
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error)

      if (attempt === maxRetries) {
        throw error
      }

      // Calculate delay with optional exponential backoff
      const delay = exponentialBackoff
        ? Math.min(retryDelay * Math.pow(2, attempt - 1), 10000)
        : retryDelay

      console.log(`Retrying in ${delay}ms...`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw new Error('All retry attempts failed')
}

export async function safeAsyncOperation<T>(
  operation: () => Promise<T>,
  fallback: T,
  options: RetryOptions = {}
): Promise<T> {
  try {
    return await fetchWithRetry(operation, options)
  } catch (error) {
    console.error('Operation failed, using fallback:', error)
    return fallback
  }
}

// ─── Bounded retry for SSR user-metadata fetch (Issue #3, 2026-05-17) ─────
//
// Production observability flagged 8 ``TypeError: fetch failed`` /
// ``ECONNRESET`` events over four days in this exact codepath, with a
// clear upward trend (3 in the last 2h on 2026-05-17). The classic
// signature is an SSR page on a Next.js node lambda hitting Supabase or
// the backend during an ALB blip — request times out at the TCP layer
// while the upstream is healthy.
//
// Fix: at most 2 retries (3 total attempts) with 200ms → 500ms backoff +
// jitter, a 5s per-call timeout, and an idempotent-only retry filter.
// Auth failures (401/403/4xx generally) MUST NOT be retried — they're
// not transient and burning retries on them masks real misconfiguration.
//
// The retry layer sits BELOW the circuit breaker: when the breaker is
// open the retry never runs at all, so a sustained Supabase outage
// can't compound into 3× the request rate against a struggling upstream.

const RETRY_BASE_DELAY_MS = 200
const RETRY_MAX_DELAY_MS = 500
const RETRY_TIMEOUT_MS = 5000
const RETRY_MAX_ATTEMPTS = 3 // initial + 2 retries

// Error-message patterns that indicate a transient network condition.
// MUST stay narrow — any pattern here is a green light to triple our
// upstream load, so adding patterns is a load-test conversation.
const TRANSIENT_NETWORK_PATTERNS = [
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ECONNREFUSED/i,
  /EAI_AGAIN/i,
  /ENOTFOUND/i,
  /fetch failed/i, // node:undici wraps ECONNRESET as this in newer versions
  /network request failed/i,
  /request timeout/i,
]

interface MaybeHttpError {
  status?: number
  response?: { status?: number }
  message?: string
  code?: string
}

/**
 * Return true iff the error is a transient network / 5xx that we should
 * retry. Conservative by default: anything we don't recognise is NOT
 * retried — false negatives surface as a single failure (acceptable),
 * false positives surface as load amplification against a sick upstream.
 */
export function isRetryableSafeFetchError(error: unknown): boolean {
  if (error == null) return false
  const err = error as MaybeHttpError

  // 1) HTTP status — only 5xx is retryable. 4xx is a definitive client
  //    error (auth, validation, not-found) — retrying just wastes load.
  const status = err.status ?? err.response?.status
  if (typeof status === 'number') {
    if (status >= 500 && status < 600) return true
    return false // includes 4xx and any explicit 2xx-with-thrown-error
  }

  // 2) Node error code (TCP-level) — ECONNRESET / ETIMEDOUT etc.
  const code = err.code
  if (typeof code === 'string' && TRANSIENT_NETWORK_PATTERNS.some(p => p.test(code))) {
    return true
  }

  // 3) Error message pattern match — covers wrapped errors where the
  //    underlying code lives in `.message` (node undici fetch: 'TypeError:
  //    fetch failed' wraps an ECONNRESET).
  const msg = err.message || (typeof error === 'string' ? error : '')
  if (msg && TRANSIENT_NETWORK_PATTERNS.some(p => p.test(msg))) {
    return true
  }

  return false
}

/**
 * Compute the delay before the (1-indexed) attempt N. Returns 0 for the
 * first attempt (immediate) and 200-500ms with jitter for retries.
 *
 * Why jitter: if the underlying outage is a brief ALB rotation, every
 * concurrent SSR worker retrying at exactly the same wall-clock instant
 * recreates the thundering-herd pattern the fix is supposed to address.
 * 30% jitter on each retry's base delay scatters the retries across
 * a band of ~200-650ms.
 */
function _safeFetchRetryDelay(attempt: number, rng: () => number = Math.random): number {
  if (attempt <= 1) return 0
  // attempt=2 → ~200ms, attempt=3 → ~500ms.
  const base = attempt === 2 ? RETRY_BASE_DELAY_MS : RETRY_MAX_DELAY_MS
  const jitter = base * 0.3 * (rng() - 0.5) * 2 // ±30% jitter
  return Math.max(50, Math.round(base + jitter))
}

/**
 * Per-call timeout wrapper. `AbortSignal.timeout` (node 20+) would be
 * preferable for cancelling the underlying fetch but the SSR call sites
 * here pass arbitrary thunks — many of them not native fetch — so we
 * use a Promise.race wrapper instead. The fetch may continue in the
 * background after timeout; that's acceptable because the SSR render
 * is what matters for user perception.
 */
async function _withTimeout<T>(op: () => Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      op(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Request timeout')),
          ms
        )
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export async function safeUserMetadataFetch<T>(
  operation: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await userMetadataCircuitBreaker.execute(async () => {
      let lastError: unknown
      for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
        const delay = _safeFetchRetryDelay(attempt)
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay))
        }
        try {
          return await _withTimeout(operation, RETRY_TIMEOUT_MS)
        } catch (err) {
          lastError = err
          // Don't waste the remaining attempts on a non-retryable error
          // (4xx / auth) — fail fast so the circuit breaker sees one
          // clean failure rather than three.
          if (!isRetryableSafeFetchError(err)) {
            throw err
          }
          // On the final attempt we've exhausted retries; throw to let
          // the breaker count this as a failure.
          if (attempt === RETRY_MAX_ATTEMPTS) {
            throw err
          }
          // Otherwise: loop and retry. We deliberately do NOT log here
          // because SSR pages already log via the outer catch; double-
          // logging clutters the console with attempt-by-attempt noise.
        }
      }
      // Unreachable — the loop always either returns or throws — but
      // satisfies TS exhaustive-return checking.
      throw lastError ?? new Error('safeUserMetadataFetch: no attempts ran')
    })
  } catch (error) {
    console.error('User metadata fetch failed (circuit breaker may be open):', error)
    return fallback
  }
}

// Test-only exports — kept under an underscore prefix as the convention
// for "implementation details not part of the public API". Tests need
// to drive delay math + retryability without reaching into the module
// via a fragile mocking layer.
export const _safeFetchInternals = {
  isRetryableSafeFetchError,
  retryDelay: _safeFetchRetryDelay,
  withTimeout: _withTimeout,
  RETRY_MAX_ATTEMPTS,
  RETRY_TIMEOUT_MS,
}
