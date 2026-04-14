/**
 * Channels API - YouTube channel data retrieval
 */
/**
 * Channel options
 */
export interface ChannelOptions {
    save?: boolean;
}
/**
 * Channel response with normalized data
 */
export interface ChannelResponse {
    id: string;
    title: string;
    description: string;
    customUrl?: string;
    publishedAt: string;
    country?: string;
    thumbnails?: {
        default?: {
            url: string;
        };
        medium?: {
            url: string;
        };
        high?: {
            url: string;
        };
    };
    statistics: {
        viewCount: string;
        subscriberCount: string;
        videoCount: string;
    };
    uploadsPlaylistId?: string;
}
/**
 * Simplified channel statistics
 */
export interface ChannelStats {
    subscribers: number;
    views: number;
    videoCount: number;
}
/**
 * Get channel by ID
 *
 * @param channelId - YouTube channel ID (starts with UC)
 * @param options - Optional settings
 * @returns Channel data
 */
export declare function getChannel(channelId: string, options?: ChannelOptions): Promise<ChannelResponse>;
/**
 * Get simplified channel statistics
 *
 * @param channelId - YouTube channel ID
 * @returns Simplified stats with numbers
 */
export declare function getChannelStats(channelId: string): Promise<ChannelStats>;
/**
 * Get multiple channels in a single API call
 *
 * @param channelIds - Array of channel IDs
 * @param options - Optional settings
 * @returns Array of channel data
 */
export declare function getMultipleChannels(channelIds: string[], options?: ChannelOptions): Promise<ChannelResponse[]>;
//# sourceMappingURL=channels.d.ts.map