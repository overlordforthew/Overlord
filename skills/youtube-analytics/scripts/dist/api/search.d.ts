/**
 * Search API - YouTube search functionality
 */
/**
 * Search options
 */
export interface SearchOptions {
    maxResults?: number;
    publishedAfter?: string;
    publishedBefore?: string;
    order?: 'date' | 'rating' | 'relevance' | 'title' | 'videoCount' | 'viewCount';
    save?: boolean;
}
/**
 * Search result item
 */
export interface SearchResultItem {
    id: {
        kind: string;
        videoId?: string;
        channelId?: string;
        playlistId?: string;
    };
    snippet: {
        title: string;
        description: string;
        publishedAt: string;
        channelId: string;
        channelTitle: string;
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
    };
}
/**
 * Search response
 */
export interface SearchResponse {
    items: SearchResultItem[];
    pageInfo?: {
        totalResults: number;
        resultsPerPage: number;
    };
    nextPageToken?: string;
    prevPageToken?: string;
}
/**
 * Search for videos
 *
 * @param query - Search query string
 * @param options - Optional settings
 * @returns Search results
 */
export declare function searchVideos(query: string, options?: SearchOptions): Promise<SearchResponse>;
/**
 * Search for channels
 *
 * @param query - Search query string
 * @param options - Optional settings
 * @returns Search results
 */
export declare function searchChannels(query: string, options?: SearchOptions): Promise<SearchResponse>;
//# sourceMappingURL=search.d.ts.map