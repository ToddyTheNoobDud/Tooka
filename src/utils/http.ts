/* Single choke point for all outbound source HTTP. Bun's fetch already
  pools connections, so the wins here are consistency: one timeout source,
  one User-Agent, uniform failure logging. */

import type { SourceContext } from '../shared/sources'

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'

export interface FetchOptions {
  headers?: Record<string, string>
  timeoutMs?: number
  label?: string
}

// GETs a URL. Returns null only when the request itself failed
// (network error, timeout). HTTP statuses - including 404 - are returned
// for the caller to interpret.
export async function fetchResponse(
  url: string,
  context: SourceContext,
  options: FetchOptions = {}
): Promise<Response | null> {
  const label = options.label ?? url.slice(0, 80)
  let response: Response
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(
        options.timeoutMs ?? context.config.sources.httpTimeoutMs
      ),
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        ...options.headers
      }
    })
  } catch (error) {
    context.logger.warn({ err: error }, `Request failed: ${label}.`)
    return null
  }
  return response
}

// GETs a URL and parses it as JSON. Null on any failure: network,
// non-OK status, wrong content-type, or bad JSON.
export async function fetchJson<T>(
  url: string,
  context: SourceContext,
  options: FetchOptions = {}
): Promise<T | null> {
  const response = await fetchResponse(url, context, options)
  if (!response) return null
  if (!response.ok) {
    context.logger.warn(
      `Request failed with status ${response.status}: ${options.label ?? url.slice(0, 80)}.`
    )
    return null
  }
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    context.logger.warn(
      `Expected JSON but got ${contentType || 'unknown type'}: ${options.label ?? url.slice(0, 80)}.`
    )
    return null
  }
  try {
    return (await response.json()) as T
  } catch (error) {
    context.logger.warn(
      { error },
      `Bad JSON: ${options.label ?? url.slice(0, 80)}.`
    )
    return null
  }
}

// Follows redirects (short links) and returns the final URL.
// Null when the hop itself failed.
export async function resolveRedirectUrl(
  url: string,
  context: SourceContext
): Promise<string | null> {
  const response = await fetchResponse(url, context, {
    label: `redirect ${url}`
  })
  if (!response) return null
  try {
    await response.body?.cancel()
  } catch {
    // body already gone, final URL is all we needed
  }
  return response.url
}
