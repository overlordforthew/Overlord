/**
 * YouTube API Client - Singleton wrapper for YouTube Data API v3
 */
import { youtube_v3 } from 'googleapis';
/**
 * Get the YouTube Data API v3 client (singleton)
 *
 * @returns The YouTube client instance
 * @throws Error if credentials are invalid
 */
export declare function getClient(): youtube_v3.Youtube;
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
//# sourceMappingURL=client.d.ts.map