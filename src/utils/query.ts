export const q = (req: Request) => new URL(req.url).searchParams

export function getRequired(sp: URLSearchParams, key: string): string | null {
  const v = sp.get(key)
  return v && v.trim() ? v : null
}

export function getInt(sp: URLSearchParams, key: string): number | null {
  const v = sp.get(key)
  if (!v) return null
  const n = Number(v)
  return Number.isInteger(n) ? n : null
}

export function getJsonObject(sp: URLSearchParams, key: string): Record<string, unknown> | null {
  const v = sp.get(key)
  if (!v) return null
  try {
    const parsed = JSON.parse(v)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}