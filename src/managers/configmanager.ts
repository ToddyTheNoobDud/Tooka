import type { ConfigProps } from '../types/config/configmanager.types'

// do not load the logger here, how you are supposed to config it while loading the config first than the logger.

// i think this does not really need to be a class for now.

/**
 * Loads a TOML module and unwraps its default export.
 * @returns The parsed config, or an empty object if not found.
 */
async function loadTomlConfig(path: string): Promise<Partial<ConfigProps>> {
  try {
    const configModule = (await import(path)) as {
      default?: Partial<ConfigProps>
    }
    return configModule.default ?? {}
  } catch {
    return {}
  }
}

// /**
//  * Merges user `config.toml` over defaults, writes it if missing.
//  * @returns Resolves when config is ready.
//  * @throws If user config fails to import/parse.
//  */
// export async function load(): Promise<ConfigProps> {
//   const defaultConfig = await loadTomlConfig(
//     `${process.cwd()}/config.default.toml`
//   )
//   let userConfig = await loadTomlConfig(`${process.cwd()}/config.toml`)

//   try {
//     // Check if the user set 'disableConfigCheck' to true in the config
//     // if so, skip all this checking process. If it errors, disable that please.
//     // i just want this to be customizable, cus why not.
//     if (userConfig.config?.disableConfigCheck) {
//       console.log('Config check is enabled, skipping...')

//       return userConfig as ConfigProps
//     }

//     // now we compare the user config with the default config
//     // and check if theres any missing fields.
//     // if there are, we merge the default config over the user config, but keep the user config's values
//     // ITS NOT strictly yet, and its completely dependent on config default, soon i'll make a proper schema for this.
//     // and everything else intact.
//     const bunCheck = Bun.file(`${process.cwd()}/config.toml`) ?? {}
//     const keys = Object.keys(defaultConfig).filter(
//       (key) => !(key in userConfig)
//     )
//     if (keys.length > 0) {
//       if (bunCheck.size === 0 || bunCheck === null) {
//         console.log(
//           "Seems like you don't have a config.toml file too, chill. Its gonna be created for you."
//         )
//       }
//       console.log(`Missing fields in config: ${keys.join(', ')}`)
//       userConfig = { ...defaultConfig, ...userConfig }
//       console.log(`Added ${keys.length} missing field(s) to your config.`)
//       await Bun.write(
//         `${process.cwd()}/config.toml`,
//         String(Bun.TOML.stringify(userConfig))
//         // Bun transforms TOML into JSON internally, so we need to stringify it back when writing to toml again ^^
//       )
//     }

//     // since bun is "performant", lets abuse it a bit hehe :p
//     // now we check if the config file has extras , and just warn the user about it.
//     // Cuz the user can be deleloping something really cool and i don't want tooka to be overwriting their config.

//     if (keys.length > 0) {
//       console.log(`Extra fields in config: ${keys.join(', ')}`)
//     }

//     // now, we can have the same length in default config as the user config
//     // but it can also happens: the user config has the wrong namings (e.g. disableConfigCheck instead of enableConfigCheck)
//     // so we can also check this, and if it has found anything like that, we can also just warn the user about it.
//     // I def also would like to implement something like a fuzzy search to find the correct field name,
//     // so it would be a nice way to find the namings, yet thats just me saying.
//     // todo.

//     console.log('Your configs loaded normally, yay!')
//     return userConfig as ConfigProps
//   } catch (error) {
//     console.log(
//       new Error(
//         `Failed to load config: ${error}, Shutting down tooka so bad things don't happen.`
//       )
//     )
//     process.exit(1)
//   }
// }
