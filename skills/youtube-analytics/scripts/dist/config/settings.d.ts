/**
 * Settings Module - Environment configuration for YouTube Data API v3
 */
/**
 * Settings interface for YouTube API configuration
 */
export interface Settings {
    /** YouTube Data API v3 key */
    apiKey: string;
    /** Default max results for list queries */
    defaultMaxResults: number;
    /** Directory path for storing results */
    resultsDir: string;
}
/**
 * Validation result from validateSettings()
 */
export interface ValidationResult {
    valid: boolean;
    errors: string[];
}
/**
 * Get current settings from environment variables
 */
export declare function getSettings(): Settings;
/**
 * Validate that all required settings are present
 */
export declare function validateSettings(): ValidationResult;
//# sourceMappingURL=settings.d.ts.map