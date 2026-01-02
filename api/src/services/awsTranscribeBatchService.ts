import { TranscribeClient, StartTranscriptionJobCommand, GetTranscriptionJobCommand, TranscriptionJobStatus, LanguageCode } from '@aws-sdk/client-transcribe';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createReadStream, existsSync, unlink } from 'fs';
import { promisify } from 'util';
import { join } from 'path';
import { unlink as unlinkFile } from 'fs/promises';
import Consultation from '../models/Consultation';
import { normalizeAudio, chunkAudio, extractAudioSegment, getAudioDuration } from '../utils/audioUtils';
import { generateSummariesInBackground } from './noteService';

const unlinkAsync = promisify(unlink);

interface BatchTranscriptionJob {
  consultationId: string;
  audioFilePath: string;
  chunks: string[];
  currentChunkIndex: number;
  fullTranscript: string;
  transcriptionJobs: Map<number, string>; // chunk index -> job name
  clientWs?: any; // WebSocket for progress updates (optional)
  detectedLanguage?: string; // Detected language from transcription
}

// Map language codes to AWS Transcribe language codes
const LANGUAGE_CODE_MAP: Record<string, string> = {
  'bn': 'bn-IN', // Bengali (India)
  'en': 'en-US', // English (US)
  'th': 'th-TH', // Thai
  'ms': 'ms-MY', // Malay (Malaysia)
  'auto': 'auto', // Auto-detect (AWS Transcribe supports this)
};

export class AWSTranscribeBatchService {
  private transcribeClient: TranscribeClient;
  private s3Client: S3Client;
  private s3Bucket: string;
  private region: string;
  private jobs: Map<string, BatchTranscriptionJob> = new Map();
  private readonly CHUNK_DURATION_SECONDS = 45; // 45 seconds per chunk

  constructor() {
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    this.region = process.env.AWS_REGION || 'us-east-1';
    this.s3Bucket = process.env.AWS_TRANSCRIBE_S3_BUCKET || '';

    if (!accessKeyId || !secretAccessKey) {
      console.warn('AWS credentials not set. AWS Transcribe will not work.');
    }

    if (!this.s3Bucket) {
      console.warn('AWS_TRANSCRIBE_S3_BUCKET not set. AWS Transcribe will not work.');
    }

    const credentials = accessKeyId && secretAccessKey ? {
      accessKeyId,
      secretAccessKey,
    } : undefined;

    this.transcribeClient = new TranscribeClient({
      region: this.region,
      credentials,
    });

    this.s3Client = new S3Client({
      region: this.region,
      credentials,
    });

    if (accessKeyId && secretAccessKey && this.s3Bucket) {
      console.log(`[AWS-TRANSCRIBE] Initialized with region: ${this.region}, bucket: ${this.s3Bucket}`);
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
    if (!this.s3Bucket) {
      throw new Error('AWS S3 bucket not configured');
    }

    console.log(`[AWS-TRANSCRIBE] Starting batch transcription for consultation ${consultationId}`);

    try {
      // Step 1: Normalize audio to 16kHz mono PCM WAV
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
        transcriptionJobs: new Map(),
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
      console.error(`[AWS-TRANSCRIBE] Error in batch transcription for ${consultationId}:`, error);
      
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
   * Process all chunks sequentially
   */
  private async processChunks(consultationId: string, languageCode: string): Promise<void> {
    const job = this.jobs.get(consultationId);
    if (!job) {
      throw new Error(`No job found for consultation ${consultationId}`);
    }

    console.log(`[AWS-TRANSCRIBE] Processing ${job.chunks.length} chunks for consultation ${consultationId}`);

    for (let i = 0; i < job.chunks.length; i++) {
      const chunkPath = job.chunks[i];
      
      try {
        console.log(`[AWS-TRANSCRIBE] Processing chunk ${i + 1}/${job.chunks.length}: ${chunkPath}`);

        // Transcribe chunk
        const result = await this.transcribeChunk(chunkPath, languageCode, consultationId, i);

        if (result.transcript && result.transcript.trim()) {
          // Append to full transcript
          job.fullTranscript += (job.fullTranscript ? ' ' : '') + result.transcript.trim();
          job.currentChunkIndex = i + 1;
          
          // Store detected language from first chunk (if auto-detect was used)
          if (result.detectedLanguage && !job.detectedLanguage) {
            job.detectedLanguage = result.detectedLanguage;
            
            // Update consultation with detected language
            const consultation = await Consultation.findById(consultationId);
            if (consultation) {
              consultation.detectedLanguage = result.detectedLanguage;
              await consultation.save();
            }
          }

          // Save transcript immediately after each chunk
          await this.saveTranscript(consultationId, job.fullTranscript, false);

          // Send progress update to client if WebSocket available
          if (job.clientWs && job.clientWs.readyState === 1) {
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
              console.log(`[AWS-TRANSCRIBE] Sent transcript update to client for ${consultationId}, progress: ${progress}%`);
            } catch (wsError) {
              console.warn(`[AWS-TRANSCRIBE] WebSocket error sending update:`, wsError);
            }
          }

          console.log(`[AWS-TRANSCRIBE] Chunk ${i + 1}/${job.chunks.length} completed. Total transcript length: ${job.fullTranscript.length} chars`);
        }
      } catch (error: any) {
        console.error(`[AWS-TRANSCRIBE] Error processing chunk ${i + 1}:`, error);
        
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

        // Continue with next chunk (resilient)
        console.warn(`[AWS-TRANSCRIBE] Continuing with next chunk after error`);
      }
    }

    // All chunks processed successfully
    console.log(`[AWS-TRANSCRIBE] All chunks processed for consultation ${consultationId}`);
    
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
      // Use detected language from transcription, fallback to consultation language
      const detectedLanguage = job.detectedLanguage || consultation?.detectedLanguage || consultation?.language;
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
        console.log(`[AWS-TRANSCRIBE] Sent final transcript update to client for ${consultationId}`);
        
        setTimeout(() => {
          if (job.clientWs && job.clientWs.readyState === 1) {
            job.clientWs.close();
          }
        }, 1000);
      } catch (wsError) {
        console.warn(`[AWS-TRANSCRIBE] WebSocket error sending final update:`, wsError);
      }
    }
  }

  /**
   * Transcribe a single audio chunk using AWS Transcribe
   * Returns transcript and detected language (if available)
   */
  private async transcribeChunk(
    chunkPath: string,
    languageCode: string,
    consultationId: string,
    chunkIndex: number
  ): Promise<{ transcript: string; detectedLanguage?: string }> {
    if (!existsSync(chunkPath)) {
      throw new Error(`Chunk file not found: ${chunkPath}`);
    }

    // Map language code
    const awsLanguageCode = LANGUAGE_CODE_MAP[languageCode] || 'en-US';
    
    // Upload chunk to S3
    const s3Key = `transcriptions/${consultationId}/chunk_${chunkIndex}_${Date.now()}.wav`;
    await this.uploadToS3(chunkPath, s3Key);

    try {
      // Start transcription job
      const jobName = `transcribe-${consultationId}-chunk-${chunkIndex}-${Date.now()}`;
      const jobUri = `s3://${this.s3Bucket}/${s3Key}`;

      const commandInput: any = {
        TranscriptionJobName: jobName,
        Media: { MediaFileUri: jobUri },
        MediaFormat: 'wav',
        Settings: {
          ShowSpeakerLabels: false,
          // Don't set MaxAlternatives - we only need the first result
        },
      };

      if (awsLanguageCode === 'auto') {
        commandInput.IdentifyLanguage = true;
        commandInput.IdentifyMultipleLanguages = false;
      } else {
        commandInput.LanguageCode = awsLanguageCode as LanguageCode;
      }

      const startCommand = new StartTranscriptionJobCommand(commandInput);

      await this.transcribeClient.send(startCommand);
      console.log(`[AWS-TRANSCRIBE] Started transcription job: ${jobName}`);

      // Poll for job completion
      const result = await this.pollTranscriptionJob(jobName);

      // Cleanup S3 object
      await this.deleteFromS3(s3Key);

      return result;
    } catch (error: any) {
      // Cleanup S3 object on error
      await this.deleteFromS3(s3Key).catch(console.error);
      
      // Provide helpful error message for permission issues
      if (error.name === 'AccessDeniedException' || error.__type === 'AccessDeniedException') {
        const helpfulError = new Error(
          `AWS Transcribe permission denied. Your IAM user needs the 'transcribe:StartTranscriptionJob' permission. ` +
          `Current user: ${error.message?.match(/User: ([^\s]+)/)?.[1] || 'unknown'}. ` +
          `Please add the 'AmazonTranscribeFullAccess' policy or create a custom policy with transcribe permissions.`
        );
        helpfulError.name = 'AccessDeniedException';
        throw helpfulError;
      }
      
      throw error;
    }
  }

  /**
   * Upload file to S3
   */
  private async uploadToS3(filePath: string, s3Key: string): Promise<void> {
    const fileStream = createReadStream(filePath);
    const fileBuffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      fileStream.on('data', (chunk: string | Buffer) => {
        if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
        } else {
          chunks.push(Buffer.from(chunk));
        }
      });
      fileStream.on('end', () => resolve(Buffer.concat(chunks)));
      fileStream.on('error', reject);
    });

    const command = new PutObjectCommand({
      Bucket: this.s3Bucket,
      Key: s3Key,
      Body: fileBuffer as Buffer,
      ContentType: 'audio/wav',
    });

    await this.s3Client.send(command);
    console.log(`[AWS-TRANSCRIBE] Uploaded chunk to S3: ${s3Key}`);
  }

  /**
   * Delete file from S3
   */
  private async deleteFromS3(s3Key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.s3Bucket,
        Key: s3Key,
      });
      await this.s3Client.send(command);
      console.log(`[AWS-TRANSCRIBE] Deleted chunk from S3: ${s3Key}`);
    } catch (error) {
      console.warn(`[AWS-TRANSCRIBE] Failed to delete S3 object ${s3Key}:`, error);
    }
  }

  /**
   * Poll transcription job until completion
   * Returns transcript and detected language (if available)
   */
  private async pollTranscriptionJob(jobName: string, maxWaitTime: number = 300000): Promise<{ transcript: string; detectedLanguage?: string }> {
    const startTime = Date.now();
    const pollInterval = 2000; // Poll every 2 seconds

    while (Date.now() - startTime < maxWaitTime) {
      const command = new GetTranscriptionJobCommand({
        TranscriptionJobName: jobName,
      });

      const response = await this.transcribeClient.send(command);
      const job = response.TranscriptionJob;

      if (!job) {
        throw new Error(`Transcription job not found: ${jobName}`);
      }

      if (job.TranscriptionJobStatus === TranscriptionJobStatus.COMPLETED) {
        // Fetch transcript from S3 URI
        if (job.Transcript?.TranscriptFileUri) {
          const transcriptUri = job.Transcript.TranscriptFileUri;
          const transcript = await this.fetchTranscriptFromUri(transcriptUri);
          
          // Extract detected language if available
          // When IdentifyLanguage is true, AWS Transcribe sets LanguageCode to the detected language
          let detectedLanguage: string | undefined;
          if (job.LanguageCode) {
            // Map AWS language code back to our format (e.g., 'bn-IN' -> 'bn', 'en-US' -> 'en')
            const awsLang = job.LanguageCode;
            if (awsLang.startsWith('bn')) detectedLanguage = 'bn';
            else if (awsLang.startsWith('en')) detectedLanguage = 'en';
            else if (awsLang.startsWith('th')) detectedLanguage = 'th';
            else if (awsLang.startsWith('ms')) detectedLanguage = 'ms';
            else detectedLanguage = awsLang.split('-')[0]; // Fallback to first part
          }
          
          return { transcript, detectedLanguage };
        }
        throw new Error('Transcription completed but no transcript URI found');
      }

      if (job.TranscriptionJobStatus === TranscriptionJobStatus.FAILED) {
        const reason = job.FailureReason || 'Unknown error';
        throw new Error(`Transcription job failed: ${reason}`);
      }

      // Job still in progress, wait and poll again
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Transcription job timed out after ${maxWaitTime}ms`);
  }

  /**
   * Fetch transcript JSON from S3 URI and extract text
   */
  private async fetchTranscriptFromUri(uri: string): Promise<string> {
    try {
      const response = await fetch(uri);
      const data: any = await response.json();
      
      // Extract transcript text from AWS Transcribe JSON format
      const transcript = data.results?.transcripts?.[0]?.transcript || '';
      return transcript;
    } catch (error: any) {
      throw new Error(`Failed to fetch transcript: ${error.message}`);
    }
  }

  /**
   * Save transcript to database
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

      const existingTranscript = consultation.transcript || '';
      if (transcript.length > existingTranscript.length || existingTranscript.length === 0) {
        consultation.transcript = transcript;
        
        if (isPartial) {
          consultation.status = 'partial';
        }
        
        await consultation.save();
        console.log(`[AWS-TRANSCRIBE] Saved transcript for ${consultationId} (${isPartial ? 'partial' : 'complete'}), length: ${transcript.length} chars`);
      }
    } catch (error) {
      console.error(`[AWS-TRANSCRIBE] Error saving transcript:`, error);
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

      this.jobs.delete(consultationId);
      console.log(`[AWS-TRANSCRIBE] Cleaned up temporary files for ${consultationId}`);
    } catch (error) {
      console.error(`[AWS-TRANSCRIBE] Error during cleanup:`, error);
    }
  }

  /**
   * Process partial recording (periodic transcription during recording)
   * Treats the snapshot as a complete audio file and transcribes it
   */
  async processPartialRecording(
    consultationId: string,
    audioFilePath: string,
    startTimeSeconds: number,
    languageCode: string,
    clientWs?: any
  ): Promise<void> {
    if (!this.s3Bucket) {
      throw new Error('AWS S3 bucket not configured');
    }

    console.log(`[AWS-TRANSCRIBE] Processing partial recording for consultation ${consultationId}, file: ${audioFilePath}, startTime: ${startTimeSeconds}s`);

    try {
      // Extract only the new portion of audio (from startTimeSeconds to end) to avoid transcribing duplicates
      const pathParts = audioFilePath.split('.');
      const extension = pathParts.pop();
      const basePath = pathParts.join('.');
      const segmentPath = `${basePath}_segment_${startTimeSeconds}.wav`;
      
      // Extract only the new audio segment
      await extractAudioSegment(audioFilePath, segmentPath, startTimeSeconds);
      
      // Check duration before normalizing to avoid unnecessary processing
      const segmentDuration = await getAudioDuration(segmentPath);
      const MIN_DURATION_SECONDS = 1.0; // Minimum 1 second (AWS requires 0.5s, but we use 1s for safety)
      
      if (segmentDuration < MIN_DURATION_SECONDS) {
        console.log(`[AWS-TRANSCRIBE] Skipping transcription - audio segment too short: ${segmentDuration.toFixed(2)}s (minimum: ${MIN_DURATION_SECONDS}s)`);
        // Cleanup and return silently (not an error)
        await unlinkFile(segmentPath).catch(console.error);
        return;
      }
      
      // Normalize the extracted segment to 16kHz mono PCM WAV
      const normalizedPath = `${basePath}_normalized.wav`;
      await normalizeAudio(segmentPath, normalizedPath);
      
      // Verify normalized audio duration as well
      const normalizedDuration = await getAudioDuration(normalizedPath);
      if (normalizedDuration < MIN_DURATION_SECONDS) {
        console.log(`[AWS-TRANSCRIBE] Skipping transcription - normalized audio too short: ${normalizedDuration.toFixed(2)}s (minimum: ${MIN_DURATION_SECONDS}s)`);
        // Cleanup and return silently
        await unlinkFile(segmentPath).catch(console.error);
        await unlinkFile(normalizedPath).catch(console.error);
        return;
      }
      
      // Cleanup the intermediate segment file
      await unlinkFile(segmentPath).catch(console.error);

      // Get or create job for this consultation
      let job = this.jobs.get(consultationId);
      if (!job) {
        // Initialize job if it doesn't exist (for partial recordings)
        job = {
          consultationId,
          audioFilePath: normalizedPath,
          chunks: [],
          currentChunkIndex: 0,
          fullTranscript: '',
          transcriptionJobs: new Map(),
          clientWs: clientWs,
        };
        this.jobs.set(consultationId, job);
      } else {
        // Update WebSocket if provided
        if (clientWs) {
          job.clientWs = clientWs;
        }
      }

      // Transcribe the snapshot as a single complete recording
      // Use timestamp as unique identifier for partial recording chunks
      const chunkTimestamp = Date.now();
      let transcriptionResult: { transcript: string; detectedLanguage?: string };
      
      try {
        transcriptionResult = await this.transcribeChunk(
          normalizedPath,
          languageCode,
          consultationId,
          chunkTimestamp
        );
      } catch (error: any) {
        // Handle "file too short" errors gracefully - don't retry, just skip
        const errorMessage = error.message || '';
        if (errorMessage.includes('too small') || errorMessage.includes('Minimum audio duration')) {
          console.log(`[AWS-TRANSCRIBE] Audio segment too short, skipping transcription (not an error)`);
          // Cleanup and return silently - this is expected when user stops talking
          await unlinkFile(normalizedPath).catch(console.error);
          return;
        }
        
        // If it's a permission error or validation error, send a helpful message to the client
        if (error.name === 'AccessDeniedException' || error.__type === 'AccessDeniedException') {
          if (job.clientWs && job.clientWs.readyState === 1) {
            try {
              job.clientWs.send(JSON.stringify({
                type: 'TRANSCRIPT_ERROR',
                consultationId,
                error: 'AWS Transcribe permission denied. Please check IAM permissions for transcribe:StartTranscriptionJob',
              }));
            } catch (wsError) {
              console.warn(`[AWS-TRANSCRIBE] WebSocket error sending permission error:`, wsError);
            }
          }
        } else if (error.name === 'BadRequestException' || error.__type === 'BadRequestException') {
          // Check if it's a "too short" error in BadRequestException
          if (errorMessage.includes('too small') || errorMessage.includes('Minimum audio duration')) {
            console.log(`[AWS-TRANSCRIBE] Audio segment too short (BadRequestException), skipping transcription`);
            await unlinkFile(normalizedPath).catch(console.error);
            return;
          }
          
          // Log other validation errors for debugging
          console.error(`[AWS-TRANSCRIBE] Bad request error:`, error.message);
          if (job.clientWs && job.clientWs.readyState === 1) {
            try {
              job.clientWs.send(JSON.stringify({
                type: 'TRANSCRIPT_ERROR',
                consultationId,
                error: `AWS Transcribe validation error: ${error.message}`,
              }));
            } catch (wsError) {
              console.warn(`[AWS-TRANSCRIBE] WebSocket error sending validation error:`, wsError);
            }
          }
        }
        throw error;
      }

      const transcript = transcriptionResult.transcript;
      if (transcript && transcript.trim()) {
        // Store detected language if available
        if (transcriptionResult.detectedLanguage && !job.detectedLanguage) {
          job.detectedLanguage = transcriptionResult.detectedLanguage;
          
          // Update consultation with detected language
          const consultation = await Consultation.findById(consultationId);
          if (consultation) {
            consultation.detectedLanguage = transcriptionResult.detectedLanguage;
            await consultation.save();
          }
        }
        // Append to existing transcript
        const existingTranscript = job.fullTranscript || '';
        job.fullTranscript = existingTranscript 
          ? `${existingTranscript} ${transcript.trim()}`
          : transcript.trim();

        // Save transcript to database
        await this.saveTranscript(consultationId, job.fullTranscript, false);

        // Send update to client via WebSocket
        if (job.clientWs && job.clientWs.readyState === 1) {
          try {
            job.clientWs.send(JSON.stringify({
              type: 'TRANSCRIPT_UPDATE',
              consultationId,
              transcript: job.fullTranscript,
              isFinal: false,
            }));
            console.log(`[AWS-TRANSCRIBE] Sent partial transcript update for ${consultationId}, length: ${job.fullTranscript.length} chars`);
          } catch (wsError) {
            console.warn(`[AWS-TRANSCRIBE] WebSocket error sending partial update:`, wsError);
          }
        }

        console.log(`[AWS-TRANSCRIBE] Processed partial recording for ${consultationId}, transcript length: ${job.fullTranscript.length} chars`);
      }

      // Cleanup normalized file
      await unlinkFile(normalizedPath).catch(console.error);

    } catch (error: any) {
      console.error(`[AWS-TRANSCRIBE] Error processing partial recording for ${consultationId}:`, error);
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

