export interface SoundCloudTrack {
  title?: string
  user?: {
    username?: string
  }
  duration?: number
  id?: number
  permalink_url?: string
  artwork_url?: string
  publisher_metadata?: {
    isrc?: string
  }
  kind?: string
}

export interface SoundCloudSearchResponse {
  collection: SoundCloudTrack[]
  total_results?: number
}

export interface SoundCloudPlaylist {
  title?: string
  user?: {
    username?: string
  }
  duration?: number
  id?: number
  permalink_url?: string
  artwork_url?: string
  tracks?: SoundCloudTrack[]
  track_count?: number
}

export interface SoundCloudResolveResponse {
  kind: string
  id?: number
  title?: string
  duration?: number
  permalink_url?: string
  artwork_url?: string
  user?: {
    username?: string
  }
  publisher_metadata?: {
    isrc?: string
  }
  tracks?: SoundCloudTrack[]
}

export const BASE_URL = 'https://api-v2.soundcloud.com'
export const SOUNDCLOUD_URL = 'https://soundcloud.com'
export const ASSET_PATTERN = /https:\/\/a-v2\.sndcdn\.com\/assets\/[a-zA-Z0-9-]+\.js/g
export const CLIENT_ID_PATTERN = /(?:[?&/]?(?:client_id)[\s:=&]*"?|"data":{"id":")([A-Za-z0-9]{32})"?/
export const URL_REGEX = /^(?:https?:\/\/)?(?:www\.)?soundcloud\.com\/.+$/i
export const SEARCH_PREFIX = 'scsearch:'
export const SEARCH_PREFIX_LOWER = 'scsearch:'