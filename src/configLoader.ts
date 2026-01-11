import path from 'node:path'

export interface ServerConfig {
  port: number
  host: string
  password: string
}

export interface Config {
  server: ServerConfig
}

const defaultConfig: Config = {
  server: { port: 50166, host: '0.0.0.0', password: 'youshallnotpass' }
}

export async function loadConfig(): Promise<Config> {
  try {
    const module = await import(path.join(process.cwd(), 'config.ts'))
    return {
      server: {
        ...defaultConfig.server,
        ...(module.default?.server ?? {})
      }
    }
  } catch {
    return defaultConfig
  }
}
