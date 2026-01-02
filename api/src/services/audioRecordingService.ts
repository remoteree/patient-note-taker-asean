import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { Writable } from 'stream';

interface RecordingSession {
  consultationId: string;
  filePath: string;
  writeStream: Writable;
  chunksReceived: number;
  startTime: Date;
  lastProcessedTime: number; // Timestamp of last transcription processing
  processedDuration: number; // Duration (in seconds) that has been transcribed
}

/**
 * Service to record audio chunks to WAV file
 * Collects PCM16 audio chunks and writes them to a WAV file
 */
export class AudioRecordingService {
  private sessions: Map<string, RecordingSession> = new Map();
  private readonly recordingsDir: string;

  constructor() {
    this.recordingsDir = join(process.cwd(), 'recordings');
    if (!existsSync(this.recordingsDir)) {
      mkdirSync(this.recordingsDir, { recursive: true });
    }
  }

  /**
   * Start recording session - creates WAV file and prepares to write PCM16 data
   */
  startRecording(consultationId: string): string {
    const filePath = join(this.recordingsDir, `recording_${consultationId}_${Date.now()}.wav`);
    
    // Create WAV file - we'll write the header at the end when we know the file size
    // For now, create a placeholder header (44 bytes) that we'll replace later
    const headerSize = 44;
    const placeholderHeader = Buffer.alloc(headerSize);
    
    const writeStream = createWriteStream(filePath);
    writeStream.write(placeholderHeader); // Placeholder header - will be replaced on stop
    
    const session: RecordingSession = {
      consultationId,
      filePath,
      writeStream,
      chunksReceived: 0,
      startTime: new Date(),
      lastProcessedTime: Date.now(),
      processedDuration: 0,
    };

    this.sessions.set(consultationId, session);
    console.log(`[AUDIO-RECORDING] Started recording for consultation ${consultationId}: ${filePath}`);
    
    return filePath;
  }

  /**
   * Write PCM16 audio chunk to the recording file
   */
  writeChunk(consultationId: string, chunk: Buffer): void {
    const session = this.sessions.get(consultationId);
    if (!session) {
      console.warn(`[AUDIO-RECORDING] No active recording session for consultation ${consultationId}`);
      return;
    }

    try {
      // Write PCM16 data directly (no conversion needed - client sends Int16Array)
      session.writeStream.write(chunk);
      session.chunksReceived++;
      
      // Log occasionally
      if (session.chunksReceived % 100 === 0) {
        console.log(`[AUDIO-RECORDING] Written ${session.chunksReceived} chunks for ${consultationId}`);
      }
    } catch (error) {
      console.error(`[AUDIO-RECORDING] Error writing chunk for ${consultationId}:`, error);
    }
  }

  /**
   * Create a snapshot of the current recording with proper WAV header
   * This allows processing while recording continues
   */
  async createSnapshot(consultationId: string): Promise<string | null> {
    const session = this.sessions.get(consultationId);
    if (!session) {
      return null;
    }

    try {
      // Get current file stats to know the size
      const fs = await import('fs/promises');
      const stats = await fs.stat(session.filePath);
      const fileSize = stats.size;
      
      // Need at least 44 bytes (header) + some data
      if (fileSize < 44 + 16000) { // At least 1 second of audio (16kHz * 2 bytes)
        return null;
      }
      
      // Read the current file data (may be incomplete, but that's okay for snapshot)
      const fileData = await fs.readFile(session.filePath);
      
      // Calculate data size (everything after the 44-byte placeholder header)
      const dataSize = fileData.length - 44;
      if (dataSize <= 0) {
        return null;
      }
      
      const totalFileSize = fileData.length - 8; // Total file size minus RIFF header size field
      
      // Create proper WAV header
      const header = Buffer.alloc(44);
      header.write('RIFF', 0);
      header.writeUInt32LE(totalFileSize, 4);
      header.write('WAVE', 8);
      header.write('fmt ', 12);
      header.writeUInt32LE(16, 16);
      header.writeUInt16LE(1, 20);
      header.writeUInt16LE(1, 22);
      header.writeUInt32LE(16000, 24);
      header.writeUInt32LE(32000, 28);
      header.writeUInt16LE(2, 32);
      header.writeUInt16LE(16, 34);
      header.write('data', 36);
      header.writeUInt32LE(dataSize, 40);
      
      // Create snapshot file with proper header
      const snapshotPath = session.filePath.replace('.wav', `_snapshot_${Date.now()}.wav`);
      const snapshotFile = Buffer.concat([header, fileData.slice(44)]);
      await fs.writeFile(snapshotPath, snapshotFile);
      
      console.log(`[AUDIO-RECORDING] Created snapshot for ${consultationId}: ${snapshotPath} (${dataSize} bytes)`);
      return snapshotPath;
    } catch (error) {
      console.error(`[AUDIO-RECORDING] Error creating snapshot:`, error);
      return null;
    }
  }

  /**
   * Stop recording and finalize WAV file with proper header
   */
  async stopRecording(consultationId: string): Promise<string> {
    const session = this.sessions.get(consultationId);
    if (!session) {
      throw new Error(`No active recording session for consultation ${consultationId}`);
    }

    return new Promise((resolve, reject) => {
      session.writeStream.end(async () => {
        try {
          // Wait a moment for file system to sync
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Read the file and write proper WAV header
          const fs = await import('fs/promises');
          const fileData = await fs.readFile(session.filePath);
          
          // Calculate data size (everything after the 44-byte placeholder header)
          const dataSize = fileData.length - 44;
          if (dataSize <= 0) {
            throw new Error('No audio data recorded');
          }
          
          const fileSize = fileData.length - 8; // Total file size minus RIFF header size field
          
          // Create proper WAV header for 16kHz, mono, 16-bit PCM
          const header = Buffer.alloc(44);
          
          // RIFF header
          header.write('RIFF', 0);
          header.writeUInt32LE(fileSize, 4);
          header.write('WAVE', 8);
          
          // fmt chunk
          header.write('fmt ', 12);
          header.writeUInt32LE(16, 16); // fmt chunk size
          header.writeUInt16LE(1, 20); // audio format (1 = PCM)
          header.writeUInt16LE(1, 22); // channels (mono)
          header.writeUInt32LE(16000, 24); // sample rate
          header.writeUInt32LE(32000, 28); // byte rate (sampleRate * channels * bitsPerSample/8)
          header.writeUInt16LE(2, 32); // block align (channels * bitsPerSample/8)
          header.writeUInt16LE(16, 34); // bits per sample
          
          // data chunk
          header.write('data', 36);
          header.writeUInt32LE(dataSize, 40);
          
          // Replace placeholder header with real header
          const finalFile = Buffer.concat([header, fileData.slice(44)]);
          await fs.writeFile(session.filePath, finalFile);
          
          const duration = (Date.now() - session.startTime.getTime()) / 1000;
          const fileSizeKB = (finalFile.length / 1024).toFixed(2);
          console.log(`[AUDIO-RECORDING] Stopped recording for ${consultationId}: ${session.filePath} (${duration.toFixed(1)}s, ${session.chunksReceived} chunks, ${fileSizeKB}KB)`);
          
          this.sessions.delete(consultationId);
          resolve(session.filePath);
        } catch (error) {
          console.error(`[AUDIO-RECORDING] Error finalizing WAV file:`, error);
          reject(error);
        }
      });
    });
  }

  /**
   * Cancel recording and cleanup
   */
  cancelRecording(consultationId: string): void {
    const session = this.sessions.get(consultationId);
    if (!session) {
      return;
    }

    session.writeStream.destroy();
    this.sessions.delete(consultationId);
    console.log(`[AUDIO-RECORDING] Cancelled recording for consultation ${consultationId}`);
  }

  /**
   * Get recording session (for periodic transcription)
   */
  getSession(consultationId: string): RecordingSession | undefined {
    return this.sessions.get(consultationId);
  }
}

