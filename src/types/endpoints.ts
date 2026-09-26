export interface Version {
  semver: string
  major: number
  minor: number
  patch: number
  preRelease: string | null
  build: string | null
}

export interface Git {
  branch: string
  commit: string
  commitTime: number
}

export interface Plugin {
  name: string
  version: string
}

export interface InfoResponse {
  version: Version
  bun: string
  isTooka: boolean
  git: Git
  sourceManagers: string[]
  filters: string[]
  plugins: Plugin[]
}
