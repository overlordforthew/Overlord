/**
 * Channels API - YouTube channel data retrieval
 */
import { getClient } from '../core/client.js';
import { saveResult } from '../core/storage.js';
/**
 * Get channel by ID
 *
 * @param channelId - YouTube channel ID (starts with UC)
 * @param options - Optional settings
 * @returns Channel data
 */
export async function getChannel(channelId, options = {}) {
    const { save = true } = options;
    const client = getClient();
    const response = await client.channels.list({
        id: [channelId],
        part: ['snippet', 'statistics', 'contentDetails'],
    });
    const item = response.data.items?.[0];
    if (!item) {
        throw new Error(`Channel not found: ${channelId}`);
    }
    const result = {
        id: item.id || channelId,
        title: item.snippet?.title || '',
        description: item.snippet?.description || '',
        customUrl: item.snippet?.customUrl,
        publishedAt: item.snippet?.publishedAt || '',
        country: item.snippet?.country,
        thumbnails: item.snippet?.thumbnails,
        statistics: {
            viewCount: item.statistics?.viewCount || '0',
            subscriberCount: item.statistics?.subscriberCount || '0',
            videoCount: item.statistics?.videoCount || '0',
        },
        uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads,
    };
    if (save) {
        saveResult(result, 'channels', 'channel', channelId);
    }
    return result;
}
/**
 * Get simplified channel statistics
 *
 * @param channelId - YouTube channel ID
 * @returns Simplified stats with numbers
 */
export async function getChannelStats(channelId) {
    const channel = await getChannel(channelId, { save: false });
    return {
        subscribers: parseInt(channel.statistics.subscriberCount, 10),
        views: parseInt(channel.statistics.viewCount, 10),
        videoCount: parseInt(channel.statistics.videoCount, 10),
    };
}
/**
 * Get multiple channels in a single API call
 *
 * @param channelIds - Array of channel IDs
 * @param options - Optional settings
 * @returns Array of channel data
 */
export async function getMultipleChannels(channelIds, options = {}) {
    const { save = true } = options;
    const client = getClient();
    const response = await client.channels.list({
        id: channelIds,
        part: ['snippet', 'statistics', 'contentDetails'],
    });
    const results = (response.data.items || []).map(item => ({
        id: item.id || '',
        title: item.snippet?.title || '',
        description: item.snippet?.description || '',
        customUrl: item.snippet?.customUrl,
        publishedAt: item.snippet?.publishedAt || '',
        country: item.snippet?.country,
        thumbnails: item.snippet?.thumbnails,
        statistics: {
            viewCount: item.statistics?.viewCount || '0',
            subscriberCount: item.statistics?.subscriberCount || '0',
            videoCount: item.statistics?.videoCount || '0',
        },
        uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads,
    }));
    if (save) {
        saveResult(results, 'channels', 'multiple_channels');
    }
    return results;
}
//# sourceMappingURL=channels.js.map