/**
 * Settings Module - Environment configuration for YouTube Data API v3
 */
import { config } from 'dotenv';
import { join } from 'path';
// Load .env file from current working directory
config();
/**
 * Get current settings from environment variables
 */
export function getSettings() {
    return {
        apiKey: process.env.YOUTUBE_API_KEY || '',
        defaultMaxResults: parseInt(process.env.YOUTUBE_DEFAULT_MAX_RESULTS || '50', 10),
        resultsDir: join(process.cwd(), 'results'),
    };
}
/**
 * Validate that all required settings are present
 */
export function validateSettings() {
    const settings = getSettings();
    const errors = [];
    if (!settings.apiKey) {
        errors.push('YOUTUBE_API_KEY is required');
    }
    return {
        valid: errors.length === 0,
        errors,
    };
}
//# sourceMappingURL=settings.js.map