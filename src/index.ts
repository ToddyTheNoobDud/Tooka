/* Hoppefully this file will be the least code.
  I will just use this for loading everything else.
  For example, config globally, logger, etc.
  I will try my best to lazy load this thing.
 */
if (!process.versions.bun) {
  throw new Error('Tooka is bun exlusive for now.')
}
if (!Bun.semver.satisfies(process.versions.bun, '>=1.4.0')) {
  throw new Error(
    'Tooka needs atleast bun 1.4.0 so functions like Map.GetOrInsert work, and its just better.'
  )
}

const star = `⠀⠀⠀⢸⣦⡀⠀⠀⠀⠀⢀⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⢸⣏⠻⣶⣤⡶⢾⡿⠁⠀⢠⣄⡀⢀⣴⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⣀⣼⠷⠀⠀⠁⢀⣿⠃⠀⠀⢀⣿⣿⣿⣇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠴⣾⣯⣅⣀⠀⠀⠀⠈⢻⣦⡀⠒⠻⠿⣿⡿⠿⠓⠂⠀⠀⢀⡇⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠉⢻⡇⣤⣾⣿⣷⣿⣿⣤⠀⠀⣿⠁⠀⠀⠀⢀⣴⣿⣿⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠸⣿⡿⠏⠀⢀⠀⠀⠿⣶⣤⣤⣤⣄⣀⣴⣿⡿⢻⣿⡆⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠟⠁⠀⢀⣼⠀⠀⠀⠹⣿⣟⠿⠿⠿⡿⠋⠀⠘⣿⣇⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⢳⣶⣶⣿⣿⣇⣀⠀⠀⠙⣿⣆⠀⠀⠀⠀⠀⠀⠛⠿⣿⣦⣤⣀⠀⠀
⠀⠀⠀⠀⠀⠀⣹⣿⣿⣿⣿⠿⠋⠁⠀⣹⣿⠳⠀⠀⠀⠀⠀⠀⢀⣠⣽⣿⡿⠟⠃
⠀⠀⠀⠀⠀⢰⠿⠛⠻⢿⡇⠀⠀⠀⣰⣿⠏⠀⠀⢀⠀⠀⠀⣾⣿⠟⠋⠁⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠋⠀⠀⣰⣿⣿⣾⣿⠿⢿⣷⣀⢀⣿⡇⠁⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠋⠉⠁⠀⠀⠀⠀⠙⢿⣿⣿⠇⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⢿⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠀⠀⠀⠀⠀⠀⠀`

// just some phrases from the anime/manga, why not.
const tookaPhrases = [
  'Shido is mine!',
  'My name is Tooka. It’s the precious name you gave me.',
  'Tooka. That’s my name. Isn’t it marvelous?',
  'Shido is the one who saved me. Shido made my world possible.',
  'No matter what happens, I’ll protect you, Shido.',
  'I will not let you take him. Shido is the one who gave me a name. He is my world.',
  'I want to eat kinako bread with Shido again.',
  'You were there for me, you saved me... and showed me how nice this world is.',
  'Even if I am a monster, Shido said I was beautiful.',
  "This time, it's my turn to help you!",
  'Shido belongs to me!',
  'I don’t want to disappear...',
  'Let’s go, Shido! There are still so many delicious things we haven’t eaten yet!'
]

const italic = (text: string) => `\x1b[3m${text}\x1b[0m`

const selectedPhrase =
  tookaPhrases[Math.floor(Math.random() * tookaPhrases.length)]
const logo = `                                   
▄▄▄▄▄▄▄▄▄                          
▀▀▀███▀▀▀             ▄▄           
   ███    ▄███▄ ▄███▄ ██ ▄█▀  ▀▀█▄  ${italic(`"${selectedPhrase}"`)}
   ███    ██ ██ ██ ██ ████   ▄█▀██  Much love, from Brazil.
   ███    ▀███▀ ▀███▀ ██ ▀█▄ ▀█▄██  Much love, by ToddyTheNoobDud, 

`

const starLines = star.split('\n')
const logoLines = logo.split('\n')
const starWidth = Math.max(...starLines.map((line) => line.length))
const bannerHeight = Math.max(starLines.length, logoLines.length)
const bannerLines: string[] = []
for (let index = 0; index < bannerHeight; index++) {
  const left = (starLines[index] ?? '').padEnd(starWidth)
  const right = logoLines[index] ?? ''
  bannerLines.push(`${left}    ${right}`)
}
console.log(bannerLines.join('\n'))

import pino from 'pino'
import { load } from './managers/configmanager.ts'
import { WebSocketServer } from './server/websocket.ts'
import { loadSources } from './sources/index.ts'

const config = await load()

let logger: pino.Logger
if (config.logging.enableLogging) {
  logger = pino({
    level: config.logging.level,
    transport: {
      target: 'pino-pretty',
      options: {
        // Tohka palette: dim trace, purple debug, vivid info/warn/error,
        // white message text. Every level must be named explicitly: with
        // customColors present, pino-pretty drops unspecified levels to
        // white unless useOnlyCustomProps is false.
        customColors:
          'trace:gray,debug:magentaBright,info:greenBright,warn:yellowBright,error:redBright,fatal:bgRed,message:white',
        useOnlyCustomProps: false
      }
    }
  })
} else {
  logger = pino({ level: 'silent' })
}

await loadSources({ config, logger })

const server = new WebSocketServer(config, logger)
server.start()

function handleErrors(error: Error, isExit: boolean, logger: pino.Logger) {
  logger.error(error)
  if (isExit) process.exit(1)
}

function handleShutdown(server: WebSocketServer, force?: boolean) {
  server.stop(force)
}

process.once('SIGINT', () => handleShutdown(server))
process.once('SIGTERM', () => handleShutdown(server))

process.on('uncaughtException', (error) => handleErrors(error, false, logger))
process.on('unhandledRejection', (reason) =>
  handleErrors(reason as Error, false, logger)
)
process.on('uncaughtExceptionMonitor', (error) =>
  handleErrors(error, true, logger)
)

logger.info('tooka has started.')

export { config, logger }
