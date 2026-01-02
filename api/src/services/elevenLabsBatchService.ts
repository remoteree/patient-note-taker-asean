import axios from 'axios';
import FormData from 'form-data';
import { createReadStream, existsSync, unlink } from 'fs';
import { promisify } from 'util';
import { join } from 'path';
import Consultation from '../models/Consultation';
import { normalizeAudio, chunkAudio, getAudioDuration } from '../utils/audioUtils';
import { generateSummariesInBackground } from './noteService';

const unlinkAsync = promisify(unlink);

interface BatchTranscriptionJob {
  consultationId: string;
  audioFilePath: string;
  chunks: string[];
  currentChunkIndex: number;
  fullTranscript: string;
  clientWs?: any; // WebSocket for progress updates (optional)
}

export class ElevenLabsBatchService {
  private apiKey: string;
  private jobs: Map<string, BatchTranscriptionJob> = new Map();
  private readonly CHUNK_DURATION_SECONDS = 45; // 45 seconds per chunk

  constructor() {
    this.apiKey = process.env.ELEVENLABS_API_KEY || '';
    if (!this.apiKey) {
      console.warn('ELEVENLABS_API_KEY not set. Bengali batch transcription will not work.');
    } else {
      console.log(`[ELEVENLABS-BATCH] API key loaded: ${this.apiKey.substring(0, 10)}... (length: ${this.apiKey.length})`);
    }
  }

  /**
   * Start batch transcription for a consultation
   * Records audio to WAV, chunks it, and processes sequentially
   */
  async startBatchTranscription(
    consultationId: string,
    audioFilePath: string,
    languageCode: string = 'bn',
    clientWs?: any
  ): Promise<void> {
    if (!this.apiKey) {
      throw new Error('Eleven Labs API key not configured');
    }

    console.log(`[ELEVENLABS-BATCH] Starting batch transcription for consultation ${consultationId}`);

    try {
      // Step 1: Normalize audio to 16kHz mono PCM WAV
      // Always use a different filename to avoid FFmpeg in-place editing error
      const pathParts = audioFilePath.split('.');
      const extension = pathParts.pop();
      const basePath = pathParts.join('.');
      const normalizedPath = `${basePath}_normalized.wav`;
      await normalizeAudio(audioFilePath, normalizedPath);

      // Step 2: Chunk the normalized audio
      const chunkDir = join(audioFilePath, '..', `chunks_${consultationId}`);
      const chunks = await chunkAudio(normalizedPath, chunkDir, this.CHUNK_DURATION_SECONDS);

      if (chunks.length === 0) {
        throw new Error('No audio chunks created');
      }

      // Step 3: Initialize job tracking
      const job: BatchTranscriptionJob = {
        consultationId,
        audioFilePath: normalizedPath,
        chunks,
        currentChunkIndex: 0,
        fullTranscript: '',
        clientWs,
      };

      this.jobs.set(consultationId, job);

      // Step 4: Update consultation status
      const consultation = await Consultation.findById(consultationId);
      if (consultation) {
        consultation.status = 'processing';
        consultation.totalChunks = chunks.length;
        consultation.processedChunks = 0;
        consultation.transcriptionProgress = 0;
        await consultation.save();
      }

      // Step 5: Process chunks sequentially
      await this.processChunks(consultationId, languageCode);

      // Step 6: Cleanup temporary files
      await this.cleanup(consultationId);
    } catch (error: any) {
      console.error(`[ELEVENLABS-BATCH] Error in batch transcription for ${consultationId}:`, error);
      
      // Save partial transcript if available
      const job = this.jobs.get(consultationId);
      if (job && job.fullTranscript) {
        await this.saveTranscript(consultationId, job.fullTranscript, true);
      }

      // Update consultation status
      const consultation = await Consultation.findById(consultationId);
      if (consultation) {
        consultation.status = 'partial';
        await consultation.save();
      }

      throw error;
    }
  }

  /**
   * Process all chunks sequentially, saving transcript after each chunk
   */
  private async processChunks(consultationId: string, languageCode: string): Promise<void> {
    const job = this.jobs.get(consultationId);
    if (!job) {
      throw new Error(`No job found for consultation ${consultationId}`);
    }

    console.log(`[ELEVENLABS-BATCH] Processing ${job.chunks.length} chunks for consultation ${consultationId}`);

    for (let i = 0; i < job.chunks.length; i++) {
      const chunkPath = job.chunks[i];
      
      try {
        console.log(`[ELEVENLABS-BATCH] Processing chunk ${i + 1}/${job.chunks.length}: ${chunkPath}`);

        // Transcribe chunk
        const chunkText = await this.transcribeChunk(chunkPath, languageCode);

        if (chunkText && chunkText.trim()) {
          // Append to full transcript
          job.fullTranscript += (job.fullTranscript ? ' ' : '') + chunkText.trim();
          job.currentChunkIndex = i + 1;

          // Save transcript immediately after each chunk
          await this.saveTranscript(consultationId, job.fullTranscript, false);

          // Send progress update to client if WebSocket available and still open
          if (job.clientWs && job.clientWs.readyState === 1) { // WebSocket.OPEN = 1
            try {
              const progress = Math.round(((i + 1) / job.chunks.length) * 100);
              job.clientWs.send(JSON.stringify({
                type: 'TRANSCRIPT_UPDATE',
                consultationId,
                transcript: job.fullTranscript,
                isFinal: false,
                progress,
                processedChunks: i + 1,
                totalChunks: job.chunks.length,
              }));
              console.log(`[ELEVENLABS-BATCH] Sent transcript update to client for ${consultationId}, progress: ${progress}%`);
            } catch (wsError) {
              console.warn(`[ELEVENLABS-BATCH] WebSocket error sending update (may be closed):`, wsError);
              // WebSocket might be closed, that's okay - transcript is saved to DB
            }
          } else {
            console.log(`[ELEVENLABS-BATCH] WebSocket not available or closed for ${consultationId}, transcript saved to DB`);
          }

          console.log(`[ELEVENLABS-BATCH] Chunk ${i + 1}/${job.chunks.length} completed. Total transcript length: ${job.fullTranscript.length} chars`);
        }
      } catch (error: any) {
        console.error(`[ELEVENLABS-BATCH] Error processing chunk ${i + 1}:`, error);
        
        // Save partial transcript before failing
        if (job.fullTranscript) {
          await this.saveTranscript(consultationId, job.fullTranscript, true);
        }

        // Update consultation to partial status
        const consultation = await Consultation.findById(consultationId);
        if (consultation) {
          consultation.status = 'partial';
          consultation.processedChunks = i;
          consultation.lastChunkProcessed = chunkPath;
          await consultation.save();
        }

        // If quota exceeded, stop processing but keep what we have
        if (error.response?.status === 429 || error.message?.includes('quota')) {
          console.warn(`[ELEVENLABS-BATCH] Quota exceeded. Saved partial transcript (${i}/${job.chunks.length} chunks)`);
          throw new Error('Quota exceeded. Partial transcript saved.');
        }

        // For other errors, continue with next chunk (resilient)
        console.warn(`[ELEVENLABS-BATCH] Continuing with next chunk after error`);
      }
    }

    // All chunks processed successfully
    console.log(`[ELEVENLABS-BATCH] All chunks processed for consultation ${consultationId}`);
    
    const consultation = await Consultation.findById(consultationId);
    if (consultation) {
      consultation.status = 'completed';
      consultation.processedChunks = job.chunks.length;
      consultation.transcriptionProgress = 100;
      await consultation.save();
    }

    // Trigger background summary generation
    if (job.fullTranscript && job.fullTranscript.trim().length > 0) {
      const consultation = await Consultation.findById(consultationId);
      const detectedLanguage = consultation?.detectedLanguage || consultation?.language;
      generateSummariesInBackground(consultationId, job.fullTranscript, detectedLanguage);
    }

    // Send final update to client if WebSocket still open
    if (job.clientWs && job.clientWs.readyState === 1) {
      try {
        job.clientWs.send(JSON.stringify({
          type: 'TRANSCRIPT_UPDATE',
          consultationId,
          transcript: job.fullTranscript,
          isFinal: true,
          progress: 100,
          processedChunks: job.chunks.length,
          totalChunks: job.chunks.length,
        }));
        console.log(`[ELEVENLABS-BATCH] Sent final transcript update to client for ${consultationId}`);
        
        // Give client time to receive the message before closing
        setTimeout(() => {
          if (job.clientWs && job.clientWs.readyState === 1) {
            job.clientWs.close();
          }
        }, 1000);
      } catch (wsError) {
        console.warn(`[ELEVENLABS-BATCH] WebSocket error sending final update (may be closed):`, wsError);
        // Transcript is saved to DB, client can reload to get it
      }
    } else {
      console.log(`[ELEVENLABS-BATCH] WebSocket closed for ${consultationId}, final transcript saved to DB`);
    }
  }

  /**
   * Transcribe a single audio chunk using ElevenLabs batch API
   */
  private async transcribeChunk(chunkPath: string, languageCode: string): Promise<string> {
    if (!existsSync(chunkPath)) {
      throw new Error(`Chunk file not found: ${chunkPath}`);
    }

    if (!this.apiKey) {
      throw new Error('ElevenLabs API key not configured');
    }

    // Check file size
    const fs = await import('fs/promises');
    const stats = await fs.stat(chunkPath);
    if (stats.size === 0) {
      throw new Error(`Chunk file is empty: ${chunkPath}`);
    }
    
    console.log(`[ELEVENLABS-BATCH] Transcribing chunk: ${chunkPath} (${stats.size} bytes), language: ${languageCode}`);

    const form = new FormData();
    
    // Append file with explicit filename and content type
    const fileStream = createReadStream(chunkPath);
    const filename = chunkPath.split('/').pop() || 'audio.wav';
    form.append('file', fileStream, {
      filename: filename,
      contentType: 'audio/wav',
    });
    
    form.append('model_id', 'scribe_v1'); // Batch model, NOT realtime
    form.append('language_code', languageCode);

    try {
      const endpoint = 'https://api.elevenlabs.io/v1/speech-to-text';
      
      // Get form headers
      const formHeaders = form.getHeaders();
      
      // Ensure API key header is set correctly and remove any conflicting auth headers
      const headers: any = {
        ...formHeaders,
        'xi-api-key': this.apiKey,
      };
      
      // Remove any conflicting authorization headers that might interfere
      delete headers.authorization;
      delete headers.Authorization;
      
      console.log(`[ELEVENLABS-BATCH] Calling endpoint: ${endpoint} with ${stats.size} byte file`);
      console.log(`[ELEVENLABS-BATCH] API key in request: ${headers['xi-api-key'] ? headers['xi-api-key'].substring(0, 15) + '...' : 'MISSING'}`);
      
      const response = await axios.post(
        endpoint,
        form,
        {
          headers: headers,
          timeout: 60000, // 60 second timeout
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        }
      );

      const transcript = response.data?.text || '';
      if (!transcript) {
        console.warn(`[ELEVENLABS-BATCH] Empty transcript returned for chunk: ${chunkPath}`);
        // Check if response has different structure
        console.log(`[ELEVENLABS-BATCH] Response data:`, JSON.stringify(response.data).substring(0, 200));
      } else {
        console.log(`[ELEVENLABS-BATCH] Successfully transcribed chunk, transcript length: ${transcript.length} chars`);
      }

      return transcript;
    } catch (error: any) {
      if (error.response) {
        const status = error.response.status;
        const data = error.response.data || {};
        const message = data?.error?.message || data?.detail || data?.message || error.message || 'Unknown error';
        
        // Log full error for debugging
        console.error(`[ELEVENLABS-BATCH] API Error Details:`, {
          status,
          statusText: error.response.statusText,
          data: typeof data === 'string' ? data.substring(0, 500) : JSON.stringify(data).substring(0, 500),
          url: error.config?.url,
          method: error.config?.method,
        });
        
        if (status === 401) {
          const errorMsg = `ElevenLabs API authentication failed (401). ` +
            `Please verify your API key is correct and has speech-to-text permissions. ` +
            `Error: ${message}`;
          console.error(`[ELEVENLABS-BATCH] ${errorMsg}`);
          throw new Error(errorMsg);
        }
        
        if (status === 429) {
          throw new Error('Quota exceeded');
        }
        
        if (status === 404) {
          throw new Error(`ElevenLabs API endpoint not found (404). The endpoint may have changed. Error: ${message}`);
        }
        
        throw new Error(`ElevenLabs API error (${status}): ${message}`);
      }
      
      console.error(`[ELEVENLABS-BATCH] Request error:`, error.message);
      throw new Error(`Failed to transcribe chunk: ${error.message}`);
    }
  }

  /**
   * Save transcript to database (append-safe)
   */
  private async saveTranscript(
    consultationId: string,
    transcript: string,
    isPartial: boolean
  ): Promise<void> {
    try {
      const consultation = await Consultation.findById(consultationId);
      if (!consultation) {
        throw new Error(`Consultation not found: ${consultationId}`);
      }

      // Only update if new transcript is longer (append-safe)
      const existingTranscript = consultation.transcript || '';
      if (transcript.length > existingTranscript.length || existingTranscript.length === 0) {
        consultation.transcript = transcript;
        
        if (isPartial) {
          consultation.status = 'partial';
        }
        
        await consultation.save();
        console.log(`[ELEVENLABS-BATCH] Saved transcript for ${consultationId} (${isPartial ? 'partial' : 'complete'}), length: ${transcript.length} chars`);
      }
    } catch (error) {
      console.error(`[ELEVENLABS-BATCH] Error saving transcript:`, error);
      throw error;
    }
  }

  /**
   * Cleanup temporary files
   */
  private async cleanup(consultationId: string): Promise<void> {
    const job = this.jobs.get(consultationId);
    if (!job) return;

    try {
      // Delete normalized audio file
      if (existsSync(job.audioFilePath)) {
        await unlinkAsync(job.audioFilePath);
      }

      // Delete chunk files
      for (const chunkPath of job.chunks) {
        if (existsSync(chunkPath)) {
          await unlinkAsync(chunkPath).catch(console.error);
        }
      }

      // Delete chunk directory if empty
      const chunkDir = join(job.chunks[0] || '', '..');
      // Note: We could delete the directory here, but leaving chunks for debugging

      this.jobs.delete(consultationId);
      console.log(`[ELEVENLABS-BATCH] Cleaned up temporary files for ${consultationId}`);
    } catch (error) {
      console.error(`[ELEVENLABS-BATCH] Error during cleanup:`, error);
      // Don't throw - cleanup errors shouldn't fail the job
    }
  }

  /**
   * Process a partial segment of the recording (for periodic transcription during recording)
   * audioFilePath is a snapshot that contains new audio from startTimeSeconds onwards
   */
  async processPartialRecording(
    consultationId: string,
    audioFilePath: string,
    startTimeSeconds: number,
    languageCode: string,
    clientWs?: WebSocket
  ): Promise<void> {
    if (!this.apiKey) {
      throw new Error('Eleven Labs API key not configured');
    }

    try {
      const { join } = await import('path');
      
      // The snapshot file is already a proper WAV file, but we may need to extract
      // only the portion from startTimeSeconds if we've already processed some
      let fileToProcess = audioFilePath;
      
      // If we've already processed some audio, extract only the new portion
      if (startTimeSeconds > 0) {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        
        const segmentPath = audioFilePath.replace('.wav', `_new_segment.wav`);
        
        // Extract segment from startTimeSeconds to end
        await execAsync(
          `ffmpeg -y -i "${audioFilePath}" -ss ${startTimeSeconds} -ac 1 -ar 16000 -f wav "${segmentPath}"`
        );
        
        fileToProcess = segmentPath;
        
        // Check duration before processing - skip if too short
        const segmentDuration = await getAudioDuration(segmentPath);
        const MIN_DURATION_SECONDS = 1.0; // Minimum 1 second
        
        if (segmentDuration < MIN_DURATION_SECONDS) {
          console.log(`[ELEVENLABS-BATCH] Skipping transcription - audio segment too short: ${segmentDuration.toFixed(2)}s (minimum: ${MIN_DURATION_SECONDS}s)`);
          const { unlink } = await import('fs/promises');
          await unlink(segmentPath).catch(console.error);
          return;
        }
      }
      
      // Normalize (in case it's not already normalized)
      const normalizedPath = fileToProcess.replace('.wav', '_normalized.wav');
      await normalizeAudio(fileToProcess, normalizedPath);
      
      // Verify normalized audio duration as well
      const normalizedDuration = await getAudioDuration(normalizedPath);
      const MIN_DURATION_SECONDS = 1.0;
      if (normalizedDuration < MIN_DURATION_SECONDS) {
        console.log(`[ELEVENLABS-BATCH] Skipping transcription - normalized audio too short: ${normalizedDuration.toFixed(2)}s (minimum: ${MIN_DURATION_SECONDS}s)`);
        const { unlink } = await import('fs/promises');
        if (fileToProcess !== audioFilePath) await unlink(fileToProcess).catch(console.error);
        await unlink(normalizedPath).catch(console.error);
        return;
      }
      
      // Chunk the audio
      const chunkDir = join(audioFilePath, '..', `chunks_${consultationId}_partial_${Date.now()}`);
      const chunks = await chunkAudio(normalizedPath, chunkDir, this.CHUNK_DURATION_SECONDS);
      
      if (chunks.length === 0) {
        console.log(`[ELEVENLABS-BATCH] No chunks created for partial segment`);
        // Cleanup
        const { unlink } = await import('fs/promises');
        if (fileToProcess !== audioFilePath) await unlink(fileToProcess).catch(console.error);
        await unlink(normalizedPath).catch(console.error);
        return;
      }
      
      // Get or create job
      let job = this.jobs.get(consultationId);
      if (!job) {
        job = {
          consultationId,
          audioFilePath: normalizedPath,
          chunks: [],
          currentChunkIndex: 0,
          fullTranscript: '',
          clientWs,
        };
        this.jobs.set(consultationId, job);
      }
      
      // Process chunks and append to existing transcript
      for (let i = 0; i < chunks.length; i++) {
        const chunkPath = chunks[i];
        try {
          const chunkText = await this.transcribeChunk(chunkPath, languageCode);
          
          if (chunkText && chunkText.trim()) {
            job.fullTranscript += (job.fullTranscript ? ' ' : '') + chunkText.trim();
            
            // Save transcript immediately
            await this.saveTranscript(consultationId, job.fullTranscript, false);
            
            // Send update to client
            if (clientWs && clientWs.readyState === 1) {
              try {
                clientWs.send(JSON.stringify({
                  type: 'TRANSCRIPT_UPDATE',
                  consultationId,
                  transcript: job.fullTranscript,
                  isFinal: false,
                }));
                console.log(`[ELEVENLABS-BATCH] Sent partial transcript update for ${consultationId}, length: ${job.fullTranscript.length} chars`);
              } catch (wsError) {
                console.warn(`[ELEVENLABS-BATCH] WebSocket error sending partial update:`, wsError);
              }
            }
          }
        } catch (error: any) {
          console.error(`[ELEVENLABS-BATCH] Error processing partial chunk ${i + 1}:`, error);
          // Continue with next chunk
        }
      }
      
      // Cleanup temporary files
      const { unlink } = await import('fs/promises');
      if (fileToProcess !== audioFilePath) await unlink(fileToProcess).catch(console.error);
      await unlink(normalizedPath).catch(console.error);
      for (const chunk of chunks) {
        await unlink(chunk).catch(console.error);
      }
      
    } catch (error: any) {
      console.error(`[ELEVENLABS-BATCH] Error processing partial recording:`, error);
      throw error;
    }
  }

  /**
   * Get current transcript for a consultation
   */
  getTranscript(consultationId: string): string {
    const job = this.jobs.get(consultationId);
    return job?.fullTranscript || '';
  }
}

