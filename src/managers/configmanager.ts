import type { ConfigProps } from '../types/config'
import { isRecord } from '../utils/json'

// The logger is created after the config loads, so this module must not use it.

/**
 * Loads a TOML module and unwraps its default export.
 * @returns The parsed config, or undefined if not found.
 */
async function loadTomlConfig(path: string): Promise<Partial<ConfigProps> | undefined> {
	if (!(await Bun.file(path).exists())) {
		return undefined
	}
	try {
		const configModule = (await import(path)) as { default?: Partial<ConfigProps> }
		return configModule.default ?? {}
	} catch {
		throw new Error(`Failed to load config from ${path}`)
	}
}

// Fills gaps in the user config with defaults, recursively. User values
// always win. Exported for unit tests; the loader is its only caller.
export function deepMergeDefaults(
	defaults: Record<string, unknown>,
	user: Record<string, unknown>,
	prefix = ''
): { merged: Record<string, unknown>; added: string[] } {
	const merged: Record<string, unknown> = { ...user }
	const added: string[] = []
	for (const [key, defaultValue] of Object.entries(defaults)) {
		const path = prefix ? `${prefix}.${key}` : key
		if (!(key in user)) {
			merged[key] = defaultValue
			added.push(path)
			continue
		}
		const userValue = user[key]
		if (isRecord(defaultValue) && isRecord(userValue)) {
			const nested = deepMergeDefaults(defaultValue, userValue, path)
			merged[key] = nested.merged
			added.push(...nested.added)
		}
	}
	return { merged, added }
}

/**
 * Loads the default and user configs and merges them.
 * @returns The merged config.
 * @throws If there is no default config, or a config fails to import.
 */
export async function load(): Promise<ConfigProps> {
	const defaultPath = `${process.cwd()}/config.default.toml`
	const userPath = `${process.cwd()}/config.toml`

	const defaultConfig = await loadTomlConfig(defaultPath)
	const userConfig = await loadTomlConfig(userPath)

	if (defaultConfig === undefined && userConfig === undefined) {
		throw new Error('Tooka has no default config file to be based on, so its not possible to start without it.')
	}

	if (defaultConfig === undefined) {
		console.log('No default config found, using user config as default')
		return userConfig as ConfigProps
	}

	if (userConfig === undefined) {
		console.log('No user config found, using default config and creating a new config.toml file for you.')
		await Bun.write(userPath, Bun.file(defaultPath))
		return defaultConfig as ConfigProps
	}

	const { merged, added } = deepMergeDefaults(
		defaultConfig as Record<string, unknown>,
		userConfig as Record<string, unknown>
	)

	if (userConfig.config?.disableConfigCheck) {
		console.log('Config check disabled, not checking for extra fields, missing fields, and even this.')
		return merged as unknown as ConfigProps
	}

	if (added.length > 0) {
		console.log(`Found ${added.length} missing field(s) in your config.toml: ${added.join(', ')}`)
		console.log('They were added automatically to your config.toml.')
		await Bun.write(userPath, Bun.TOML.stringify(merged))
	}

	const extraKeys = Object.keys(userConfig).filter((key) => !(key in defaultConfig))
	if (extraKeys.length > 0) {
		console.log(`Found ${extraKeys.length} extra field(s) in your config.toml: ${extraKeys.join(', ')}`)
		console.log('This is just a warn, the extra fields will be ignored.')
	}

	return merged as unknown as ConfigProps
}
