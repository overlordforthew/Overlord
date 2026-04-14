/**
 * YouTube API Client - lightweight REST wrapper for YouTube Data API v3.
 *
 * We keep the same `client.<resource>.list()` shape the rest of the skill
 * already uses, but implement it with native fetch so the skill no longer
 * needs the very large googleapis package at runtime.
 */

import { getSettings, validateSettings } from '../config/settings.js';

type Scalar = string | number | boolean;
type ParamValue = Scalar | Scalar[] | undefined;
type Params = Record<string, ParamValue>;

type YoutubeListResult<T = any> = Promise<{ data: T }>;

interface YoutubeResource {
  list(params: Params): YoutubeListResult;
}

export interface YoutubeClient {
  channels: YoutubeResource;
  videos: YoutubeResource;
  playlistItems: YoutubeResource;
  search: YoutubeResource;
}

const API_BASE = 'https://www.googleapis.com/youtube/v3';

class YoutubeRestClient implements YoutubeClient {
  constructor(private readonly apiKey: string) {}

  channels = { list: (params: Params) => this.list('channels', params) };
  videos = { list: (params: Params) => this.list('videos', params) };
  playlistItems = { list: (params: Params) => this.list('playlistItems', params) };
  search = { list: (params: Params) => this.list('search', params) };

  private async list(resource: string, params: Params): YoutubeListResult {
    const query = new URLSearchParams({ key: this.apiKey });

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        query.set(key, value.join(','));
      } else {
        query.set(key, String(value));
      }
    }

    const response = await fetch(`${API_BASE}/${resource}?${query.toString()}`);

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const body = await response.json() as { error?: { message?: string } };
        detail = body.error?.message || detail;
      } catch {
        // Keep the HTTP status text when the response body is not JSON.
      }
      throw new Error(`YouTube API ${resource} failed (${response.status}): ${detail}`);
    }

    return { data: await response.json() };
  }
}

// Singleton client instance
let clientInstance: YoutubeClient | null = null;

/**
 * Get the YouTube Data API v3 client (singleton)
 *
 * @returns The YouTube client instance
 * @throws Error if credentials are invalid
 */
export function getClient(): YoutubeClient {
  if (clientInstance) {
    return clientInstance;
  }

  const validation = validateSettings();
  if (!validation.valid) {
    throw new Error(`Invalid YouTube credentials: ${validation.errors.join(', ')}`);
  }

  const settings = getSettings();
  clientInstance = new YoutubeRestClient(settings.apiKey);
  return clientInstance;
}

/**
 * Get the YouTube API key from settings
 *
 * @returns API key string
 */
export function getApiKey(): string {
  const settings = getSettings();
  return settings.apiKey;
}

/**
 * Reset the client singleton (useful for testing)
 */
export function resetClient(): void {
  clientInstance = null;
}
