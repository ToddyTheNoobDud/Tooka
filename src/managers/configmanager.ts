import type { ConfigProps } from '../types/config/configmanager.types'

// do not load the logger here, how you are supposed to config it while loading the config first than the logger.

// i think this does not really need to be a class for now.

/**
 * Loads a TOML module and unwraps its default export.
 * @returns The parsed config, or undefined if not found.
 */
async function loadTomlConfig(
  path: string
): Promise<Partial<ConfigProps> | undefined> {
  if (!(await Bun.file(path).exists())) return undefined
  try {
    const configModule = (await import(path)) as {
      default?: Partial<ConfigProps>
    }
    return configModule.default ?? {}
  } catch {
    throw new Error(`Failed to load config from ${path}`)
  }
}

/**
 *
 * @returns Resolves when config is ready.
 * @throws If user config fails to import/parse.
 */
export async function load(): Promise<ConfigProps> {
  const defaultConfig = await loadTomlConfig(
    `${process.cwd()}/config.default.toml`
  )
  const userConfig = await loadTomlConfig(`${process.cwd()}/config.toml`)

  // we have the default config but we don't have the userConfig file, so we just warn the user it does not exist and we create it.
  if (defaultConfig === undefined && userConfig !== undefined) {
    console.log('No default config found, using user config as default')
    return userConfig as ConfigProps
  }

  // now we don't have a default config but we do have the userConfig file, so we use it.
  if (defaultConfig !== undefined && userConfig === undefined) {
    console.log(
      'No user config found, using default config and creating a new config.toml file for you.'
    )
    await Bun.write(
      `${process.cwd()}/config.toml`,
      Bun.TOML.stringify(defaultConfig) as string
    )
    return defaultConfig as ConfigProps
  }

  // now we don't have a default config and we don't have the userConfig file, tooka can't start without a config, pretty sad...
  if (defaultConfig === undefined) {
    throw new Error(
      'Tooka has no default config file to be based on, so its not possible to start without it.'
    )
  }

  if (userConfig?.config?.disableConfigCheck) {
    console.log(
      'Config check disabled, not checking for extra fields, missing fields, and even this.'
    )

    return userConfig as ConfigProps
  }

  // now we will iterate over the userConfig and check for extra fields, missing fields, etc
  const keys = Object.keys(defaultConfig).filter((key) => !(key in userConfig!))
  if (keys.length > 0) {
    console.log(`Found ${keys.length} missing field(s) in your config.toml: ${keys.join(', ')}`)
    console.log('It will be added automatically to your config.toml.')
    const updatedConfig = { ...defaultConfig, ...userConfig }
    await Bun.write(
      `${process.cwd()}/config.toml`,
      Bun.TOML.stringify(updatedConfig) as string
    )
    return updatedConfig as ConfigProps
  }

  // now we just warn if there are extra fields in the userConfig
  const extraKeys = Object.keys(userConfig!).filter((key) => !(key in defaultConfig))
  if (extraKeys.length > 0) {
    console.log(`Found ${extraKeys.length} extra field(s) in your config.toml: ${extraKeys.join(', ')}`)
    console.log('This is just a warn, the extra fields will be ignored.')
  }

  return userConfig as ConfigProps
}
