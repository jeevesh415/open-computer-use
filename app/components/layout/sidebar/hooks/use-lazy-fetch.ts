"use client"

import { useState, useRef, useCallback } from "react"

/**
 * Hook that defers a fetch until explicitly triggered (e.g. on first hover).
 * Returns stable trigger callback — safe to pass as prop without causing re-renders.
 *
 * @param url     API endpoint
 * @param extract Transforms the JSON response into the desired shape
 * @param fallback Initial value before any fetch
 */
export function useLazyFetch<T>(
  url: string,
  extract: (data: any) => T,
  fallback: T
): [data: T, trigger: () => void] {
  const [data, setData] = useState<T>(fallback)
  const fetchedRef = useRef(false)

  // Keep url/extract in refs so the callback is stable
  const urlRef = useRef(url)
  const extractRef = useRef(extract)
  urlRef.current = url
  extractRef.current = extract

  const trigger = useCallback(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true

    fetch(urlRef.current)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setData(extractRef.current(d))
      })
      .catch(() => {})
  }, [])

  return [data, trigger]
}
