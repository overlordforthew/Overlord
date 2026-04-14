/**
 * YouTube API Client - lightweight REST wrapper for YouTube Data API v3.
 *
 * We keep the same `client.<resource>.list()` shape the rest of the skill
 * already uses, but implement it with native fetch so the skill no longer
 * needs the very large googleapis package at runtime.
 */
type Scalar = string | number | boolean;
type ParamValue = Scalar | Scalar[] | undefined;
type Params = Record<string, ParamValue>;
type YoutubeListResult<T = any> = Promise<{
    data: T;
}>;
interface YoutubeResource {
    list(params: Params): YoutubeListResult;
}
export interface YoutubeClient {
    channels: YoutubeResource;
    videos: YoutubeResource;
    playlistItems: YoutubeResource;
    search: YoutubeResource;
}
/**
 * Get the YouTube Data API v3 client (singleton)
 *
 * @returns The YouTube client instance
 * @throws Error if credentials are invalid
 */
export declare function getClient(): YoutubeClient;
/**
 * Get the YouTube API key from settings
 *
 * @returns API key string
 */
export declare function getApiKey(): string;
/**
 * Reset the client singleton (useful for testing)
 */
export declare function resetClient(): void;
export {};
//# sourceMappingURL=client.d.ts.map