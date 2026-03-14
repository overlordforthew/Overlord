#!/usr/bin/env node
/**
 * Audio Transcription via Groq Whisper
 *
 * Transcribes audio files using Groq's Whisper API (free tier).
 * Handles files >25MB by splitting with ffmpeg.
 *
 * Usage: node audio-transcribe.js <audio-file-path>
 * Returns: plain text transcript
 */

import { readFileSync, unlinkSync, existsSync } from 'fs';
import { execSync, spawnSync } from 'child_process';
import https from 'https';
import { basename } from 'path';

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: node audio-transcribe.js <audio-file>');
  process.exit(1);
}

if (!GROQ_API_KEY) {
  console.error('GROQ_API_KEY not set');
  process.exit(1);
}

// Convert to mp3 if needed, ensure under 25MB
function prepareAudio(inputPath) {
  const ext = inputPath.split('.').pop().toLowerCase();
  const supportedFormats = ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm', 'ogg', 'flac'];

  // Check file size
  const sizeStr = execSync(`stat -c%s "${inputPath}" 2>/dev/null || stat -f%z "${inputPath}"`).toString().trim();
  const size = parseInt(sizeStr);

  if (supportedFormats.includes(ext) && size <= 24 * 1024 * 1024) {
    return [inputPath]; // Use as-is
  }

  // Need to convert/compress — split into chunks if large
  const maxChunkSeconds = 600; // 10 min chunks
  const durationStr = spawnSync('ffprobe', [
    '-v', 'quiet', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', inputPath
  ], { timeout: 10000 }).stdout?.toString().trim();
  const duration = parseFloat(durationStr) || 0;

  if (duration <= maxChunkSeconds || size <= 24 * 1024 * 1024) {
    // Single file, just compress
    const outPath = `/tmp/whisper-input-${Date.now()}.mp3`;
    spawnSync('ffmpeg', ['-i', inputPath, '-b:a', '48k', '-ar', '16000', '-ac', '1', '-y', outPath], { timeout: 120000 });
    return [outPath];
  }

  // Split into chunks
  const numChunks = Math.ceil(duration / maxChunkSeconds);
  const chunks = [];
  for (let i = 0; i < numChunks; i++) {
    const outPath = `/tmp/whisper-chunk-${Date.now()}-${i}.mp3`;
    spawnSync('ffmpeg', [
      '-i', inputPath, '-ss', String(i * maxChunkSeconds),
      '-t', String(maxChunkSeconds),
      '-b:a', '48k', '-ar', '16000', '-ac', '1', '-y', outPath
    ], { timeout: 60000 });
    if (existsSync(outPath)) chunks.push(outPath);
  }
  return chunks;
}

// Send audio to Groq Whisper
async function transcribeChunk(audioPath) {
  const audioBuffer = readFileSync(audioPath);
  const filename = basename(audioPath);

  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
  const parts = [];
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/mpeg\r\n\r\n`);
  parts.push(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3-turbo`);
  parts.push(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\ntext`);
  parts.push(`\r\n--${boundary}--\r\n`);

  const header = Buffer.from(parts[0]);
  const middle = Buffer.from(parts[1] + parts[2] + parts[3]);
  const body = Buffer.concat([header, audioBuffer, middle]);

  return new Promise((resolve, reject) => {
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
}

async function main() {
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const chunks = prepareAudio(filePath);
  const transcripts = [];

  for (const chunk of chunks) {
    const text = await transcribeChunk(chunk);
    transcripts.push(text.trim());
    // Clean up temp chunks (but not the original)
    if (chunk !== filePath && chunk.startsWith('/tmp/')) {
      try { unlinkSync(chunk); } catch {}
    }
  }

  console.log(transcripts.join(' '));
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
