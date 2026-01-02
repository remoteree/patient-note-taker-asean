import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const execAsync = promisify(exec);

/**
 * Normalize audio file to 16kHz mono PCM WAV format
 * Required format for ElevenLabs batch transcription
 */
export async function normalizeAudio(input: string, output: string): Promise<void> {
  if (!existsSync(input)) {
    throw new Error(`Input audio file not found: ${input}`);
  }

  // Ensure output directory exists
  const outputDir = join(output, '..');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  try {
    await execAsync(
      `ffmpeg -y -i "${input}" -ac 1 -ar 16000 -f wav "${output}"`
    );
    console.log(`[AUDIO] Normalized audio: ${input} -> ${output}`);
  } catch (error: any) {
    console.error(`[AUDIO] Error normalizing audio:`, error);
    throw new Error(`Failed to normalize audio: ${error.message}`);
  }
}

/**
 * Chunk audio file into segments of specified duration (in seconds)
 * Creates chunks in the specified output directory
 * Returns array of chunk file paths
 */
export async function chunkAudio(
  input: string,
  chunkDir: string,
  seconds: number = 45
): Promise<string[]> {
  if (!existsSync(input)) {
    throw new Error(`Input audio file not found: ${input}`);
  }

  // Ensure chunk directory exists
  if (!existsSync(chunkDir)) {
    mkdirSync(chunkDir, { recursive: true });
  }

  try {
    // Use ffmpeg segment to create chunks
    // -f segment: use segment muxer
    // -segment_time: duration of each segment in seconds
    // -c copy: copy codec (faster, but may not work for all formats)
    // If copy fails, we'll use re-encoding
    const outputPattern = join(chunkDir, 'chunk_%03d.wav');
    
    try {
      // Try with codec copy first (faster)
      await execAsync(
        `ffmpeg -y -i "${input}" -f segment -segment_time ${seconds} -c copy "${outputPattern}"`
      );
    } catch (copyError) {
      // If copy fails, re-encode to ensure compatibility
      console.log(`[AUDIO] Codec copy failed, re-encoding chunks...`);
      await execAsync(
        `ffmpeg -y -i "${input}" -f segment -segment_time ${seconds} -ac 1 -ar 16000 -f wav "${outputPattern}"`
      );
    }

    // List generated chunk files
    const { stdout } = await execAsync(`ls -1 "${chunkDir}"/chunk_*.wav | sort`);
    const chunks = stdout.trim().split('\n').filter(Boolean);
    
    console.log(`[AUDIO] Created ${chunks.length} chunks from ${input}`);
    return chunks;
  } catch (error: any) {
    console.error(`[AUDIO] Error chunking audio:`, error);
    throw new Error(`Failed to chunk audio: ${error.message}`);
  }
}

/**
 * Get audio duration in seconds
 */
export async function getAudioDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    );
    return parseFloat(stdout.trim()) || 0;
  } catch (error: any) {
    console.error(`[AUDIO] Error getting duration:`, error);
    return 0;
  }
}

/**
 * Extract a portion of audio from startTime to end of file
 * Used for partial transcription to avoid transcribing the same audio multiple times
 */
export async function extractAudioSegment(
  input: string,
  output: string,
  startTimeSeconds: number
): Promise<void> {
  if (!existsSync(input)) {
    throw new Error(`Input audio file not found: ${input}`);
  }

  // Ensure output directory exists
  const outputDir = join(output, '..');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  try {
    // Extract audio from startTimeSeconds to end
    // -ss: start time
    // -i: input file
    // -ac 1 -ar 16000: ensure mono 16kHz
    await execAsync(
      `ffmpeg -y -ss ${startTimeSeconds} -i "${input}" -ac 1 -ar 16000 -f wav "${output}"`
    );
    console.log(`[AUDIO] Extracted audio segment from ${startTimeSeconds}s: ${input} -> ${output}`);
  } catch (error: any) {
    console.error(`[AUDIO] Error extracting audio segment:`, error);
    throw new Error(`Failed to extract audio segment: ${error.message}`);
  }
}

