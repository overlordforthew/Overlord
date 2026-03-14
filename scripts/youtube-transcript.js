#!/usr/bin/env node
/**
 * YouTube Transcript Extractor
 *
 * Extracts transcripts/captions from YouTube videos using multiple strategies:
 * 1. YouTube's internal caption tracks (web scraping)
 * 2. yt-dlp subtitle download
 * 3. yt-dlp audio download + Groq Whisper transcription
 *
 * Usage: node youtube-transcript.js <youtube-url>
 * Returns: JSON { title, transcript, method, duration }
 */

import { execSync, spawnSync } from 'child_process';
import https from 'https';
import http from 'http';

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const url = process.argv[2];

if (!url) {
  console.error('Usage: node youtube-transcript.js <youtube-url>');
  process.exit(1);
}

// Extract video ID from various YouTube URL formats
function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

// Fetch URL content
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve, reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// Strategy 1: Extract captions from YouTube's player response
async function extractWebCaptions(videoId) {
  const html = await fetchUrl(`https://www.youtube.com/watch?v=${videoId}`);

  // Get title
  const titleMatch = html.match(/<title>(.+?)<\/title>/);
  const title = titleMatch ? titleMatch[1].replace(' - YouTube', '').trim() : 'Unknown';

  // Find caption tracks in ytInitialPlayerResponse
  const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
  if (!playerMatch) return null;

  let playerResponse;
  try {
    playerResponse = JSON.parse(playerMatch[1]);
  } catch { return null; }

  const captions = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!captions || captions.length === 0) return null;

  // Prefer English, then auto-generated, then first available
  const track = captions.find(t => t.languageCode === 'en' && !t.kind)
    || captions.find(t => t.languageCode === 'en')
    || captions[0];

  if (!track?.baseUrl) return null;

  // Fetch the caption XML and parse it
  const captionUrl = track.baseUrl + '&fmt=json3';
  const captionData = await fetchUrl(captionUrl);

  let transcript;
  try {
    const json = JSON.parse(captionData);
    const events = json.events || [];
    transcript = events
      .filter(e => e.segs)
      .map(e => e.segs.map(s => s.utf8).join(''))
      .join(' ')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    // Fallback: try XML format
    const xmlUrl = track.baseUrl;
    const xmlData = await fetchUrl(xmlUrl);
    transcript = xmlData
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (!transcript || transcript.length < 20) return null;

  return { title, transcript, method: 'web-captions', lang: track.languageCode };
}

// Strategy 2: Use yt-dlp to download subtitles
async function extractYtdlpSubtitles(videoId) {
  try {
    // Get title
    const titleResult = spawnSync('yt-dlp', ['--get-title', `https://youtube.com/watch?v=${videoId}`], { timeout: 15000 });
    const title = titleResult.stdout?.toString().trim() || 'Unknown';

    // Try to get auto-generated subs
    const result = spawnSync('yt-dlp', [
      '--write-auto-sub', '--sub-lang', 'en', '--skip-download',
      '--sub-format', 'vtt', '-o', `/tmp/yt-${videoId}`,
      `https://youtube.com/watch?v=${videoId}`
    ], { timeout: 30000 });

    // Check for downloaded subtitle file
    const { execSync: exec } = await import('child_process');
    const vttFile = exec(`ls /tmp/yt-${videoId}*.vtt 2>/dev/null`).toString().trim();

    if (!vttFile) return null;

    const vttContent = exec(`cat "${vttFile}"`).toString();
    // Clean up temp files
    exec(`rm -f /tmp/yt-${videoId}*`);

    // Parse VTT: strip timestamps and metadata, keep text
    const transcript = vttContent
      .split('\n')
      .filter(line => !line.match(/^(WEBVTT|Kind:|Language:|$|\d{2}:\d{2})/))
      .filter(line => !line.match(/^<\d{2}:\d{2}/))
      .map(line => line.replace(/<[^>]+>/g, ''))
      .filter(line => line.trim())
      // Deduplicate consecutive repeated lines (VTT often repeats)
      .filter((line, i, arr) => i === 0 || line.trim() !== arr[i - 1]?.trim())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!transcript || transcript.length < 20) return null;

    return { title, transcript, method: 'yt-dlp-subtitles' };
  } catch {
    return null;
  }
}

// Strategy 3: Download audio with yt-dlp, transcribe with Groq Whisper
async function extractWithWhisper(videoId) {
  if (!GROQ_API_KEY) {
    console.error('GROQ_API_KEY not set, skipping Whisper transcription');
    return null;
  }

  try {
    // Get title
    const titleResult = spawnSync('yt-dlp', ['--get-title', `https://youtube.com/watch?v=${videoId}`], { timeout: 15000 });
    const title = titleResult.stdout?.toString().trim() || 'Unknown';

    const audioPath = `/tmp/yt-audio-${videoId}.mp3`;

    // Download audio (mp3, max 25MB for Groq)
    const dlResult = spawnSync('yt-dlp', [
      '-x', '--audio-format', 'mp3', '--audio-quality', '5',
      '--max-filesize', '24M',
      '-o', audioPath,
      `https://youtube.com/watch?v=${videoId}`
    ], { timeout: 120000 });

    // Check file exists
    try { execSync(`test -f "${audioPath}"`); } catch { return null; }

    // Check file size — if >25MB, compress with ffmpeg
    const sizeStr = execSync(`stat -f%z "${audioPath}" 2>/dev/null || stat -c%s "${audioPath}"`).toString().trim();
    const size = parseInt(sizeStr);

    if (size > 24 * 1024 * 1024) {
      // Re-encode to lower bitrate
      const compressedPath = `/tmp/yt-audio-${videoId}-small.mp3`;
      spawnSync('ffmpeg', ['-i', audioPath, '-b:a', '32k', '-ar', '16000', '-ac', '1', '-y', compressedPath], { timeout: 60000 });
      execSync(`mv "${compressedPath}" "${audioPath}"`);
    }

    // Send to Groq Whisper API
    const { readFileSync, unlinkSync } = await import('fs');
    const audioBuffer = readFileSync(audioPath);

    // Build multipart form data manually
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
    const parts = [];
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`);
    const fileData = audioBuffer;
    parts.push(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3-turbo`);
    parts.push(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\ntext`);
    parts.push(`\r\n--${boundary}--\r\n`);

    const header = Buffer.from(parts[0]);
    const middle = Buffer.from(parts[1] + parts[2] + parts[3]);
    const body = Buffer.concat([header, fileData, middle]);

    const transcript = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.groq.com',
        path: '/openai/v1/audio/transcriptions',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
        timeout: 120000,
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode !== 200) reject(new Error(`Groq ${res.statusCode}: ${data}`));
          else resolve(data);
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    // Clean up
    try { unlinkSync(audioPath); } catch {}

    if (!transcript || transcript.trim().length < 20) return null;

    return { title, transcript: transcript.trim(), method: 'groq-whisper' };
  } catch (err) {
    console.error('Whisper error:', err.message);
    // Clean up on error
    try { execSync(`rm -f /tmp/yt-audio-${videoId}*`); } catch {}
    return null;
  }
}

// Main execution
async function main() {
  const videoId = extractVideoId(url);
  if (!videoId) {
    console.error('Invalid YouTube URL');
    process.exit(1);
  }

  // Try strategies in order
  let result;

  result = await extractWebCaptions(videoId);
  if (result) {
    console.log(JSON.stringify(result));
    return;
  }

  result = await extractYtdlpSubtitles(videoId);
  if (result) {
    console.log(JSON.stringify(result));
    return;
  }

  result = await extractWithWhisper(videoId);
  if (result) {
    console.log(JSON.stringify(result));
    return;
  }

  console.error('All transcript extraction methods failed');
  process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
