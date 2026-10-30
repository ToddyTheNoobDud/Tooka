// Narrows unknown JSON-derived values to plain string-keyed objects.
// Excludes null and arrays.
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
