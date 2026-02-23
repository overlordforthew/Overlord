/**
 * YouTube Analytics Toolkit - Main Entry Point
 *
 * Simple interface for YouTube Data API v3 analysis.
 * All results are automatically saved to the /results directory with timestamps.
 *
 * Usage:
 *   import { getChannelStats, searchVideos } from './index.js';
 *   const stats = await getChannelStats('UCxxxxxxxx');
 */
export * from './api/channels.js';
export * from './api/videos.js';
export * from './api/search.js';
export { getClient, getApiKey, resetClient } from './core/client.js';
export { saveResult, loadResult, listResults, getLatestResult } from './core/storage.js';
export { getSettings, validateSettings } from './config/settings.js';
import { getChannel } from './api/channels.js';
import { getVideo, getChannelVideos } from './api/videos.js';
/**
 * Channel analysis result
 */
export interface ChannelAnalysis {
    channel: Awaited<ReturnType<typeof getChannel>>;
    recentVideos: Awaited<ReturnType<typeof getChannelVideos>>;
    stats: {
        subscribers: number;
        totalViews: number;
        videoCount: number;
        avgViewsPerVideo: number;
    };
}
/**
 * Comprehensive channel analysis - get channel info, recent videos, and calculated stats
 *
 * @param channelId - YouTube channel ID
 * @returns Channel data with recent videos and calculated metrics
 */
export declare function analyzeChannel(channelId: string): Promise<ChannelAnalysis>;
/**
 * Compare multiple YouTube channels
 *
 * @param channelIds - Array of channel IDs to compare
 * @returns Comparison data for all channels
 */
export declare function compareChannels(channelIds: string[]): Promise<{
    channels: {
        id: string;
        title: string;
        subscribers: number;
        views: number;
        videoCount: number;
        viewsPerVideo: number;
    }[];
    summary: {
        totalChannels: number;
        totalSubscribers: number;
        totalViews: number;
        topBySubscribers: string;
    };
}>;
/**
 * Video analysis result
 */
export interface VideoAnalysis {
    video: Awaited<ReturnType<typeof getVideo>>;
    engagement: {
        views: number;
        likes: number;
        comments: number;
        likeRate: number;
        commentRate: number;
    };
}
/**
 * Analyze a single video's performance
 *
 * @param videoId - YouTube video ID
 * @returns Video data with engagement metrics
 */
export declare function analyzeVideo(videoId: string): Promise<VideoAnalysis>;
/**
 * Search and analyze top videos for a keyword
 *
 * @param query - Search query
 * @param maxResults - Number of results (default 10)
 * @returns Search results with video stats
 */
export declare function searchAndAnalyze(query: string, maxResults?: number): Promise<{
    query: string;
    videos: {
        id: string;
        title: string;
        channelTitle: string;
        views: number;
        likes: number;
        comments: number;
        publishedAt: string;
    }[];
}>;
//# sourceMappingURL=index.d.ts.map