/**
 * Videos API - YouTube video data retrieval
 */
/**
 * Video options
 */
export interface VideoOptions {
    save?: boolean;
}
/**
 * Channel videos options
 */
export interface ChannelVideosOptions {
    maxResults?: number;
    save?: boolean;
}
/**
 * Video response with normalized data
 */
export interface VideoResponse {
    id: string;
    title: string;
    description: string;
    publishedAt: string;
    channelId: string;
    channelTitle: string;
    tags?: string[];
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
        likeCount: string;
        commentCount: string;
    };
    duration?: string;
}
/**
 * Simplified video statistics
 */
export interface VideoStats {
    views: number;
    likes: number;
    comments: number;
}
/**
 * Get video by ID
 *
 * @param videoId - YouTube video ID
 * @param options - Optional settings
 * @returns Video data
 */
export declare function getVideo(videoId: string, options?: VideoOptions): Promise<VideoResponse>;
/**
 * Get simplified video statistics
 *
 * @param videoId - YouTube video ID
 * @returns Simplified stats with numbers
 */
export declare function getVideoStats(videoId: string): Promise<VideoStats>;
/**
 * Get multiple videos in a single API call
 *
 * @param videoIds - Array of video IDs
 * @param options - Optional settings
 * @returns Array of video data
 */
export declare function getMultipleVideos(videoIds: string[], options?: VideoOptions): Promise<VideoResponse[]>;
/**
 * Get videos from a channel's uploads playlist
 *
 * @param channelId - YouTube channel ID
 * @param options - Optional settings including maxResults
 * @returns Array of video data
 */
export declare function getChannelVideos(channelId: string, options?: ChannelVideosOptions): Promise<VideoResponse[]>;
//# sourceMappingURL=videos.d.ts.map