/**
 * YouTube API Client - Singleton wrapper for YouTube Data API v3
 */
import { google } from 'googleapis';
import { getSettings, validateSettings } from '../config/settings.js';
// Singleton client instance
let clientInstance = null;
/**
 * Get the YouTube Data API v3 client (singleton)
 *
 * @returns The YouTube client instance
 * @throws Error if credentials are invalid
 */
export function getClient() {
    if (clientInstance) {
        return clientInstance;
    }
    const validation = validateSettings();
    if (!validation.valid) {
        throw new Error(`Invalid YouTube credentials: ${validation.errors.join(', ')}`);
    }
    const settings = getSettings();
    clientInstance = google.youtube({
        version: 'v3',
        auth: settings.apiKey,
    });
    return clientInstance;
}
/**
 * Get the YouTube API key from settings
 *
 * @returns API key string
 */
export function getApiKey() {
    const settings = getSettings();
    return settings.apiKey;
}
/**
 * Reset the client singleton (useful for testing)
 */
export function resetClient() {
    clientInstance = null;
}
//# sourceMappingURL=client.js.map