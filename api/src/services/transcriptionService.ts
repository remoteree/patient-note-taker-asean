import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { WebSocket } from 'ws';
import { ElevenLabsBatchService } from './elevenLabsBatchService';
import { AWSTranscribeBatchService } from './awsTranscribeBatchService';
import TranscriptionConfig from '../models/TranscriptionConfig';

import { ConsultationLanguage } from '../models/Consultation';

export interface TranscriptionService {
  startSession(consultationId: string, clientWs: WebSocket, language: ConsultationLanguage, enableLanguageDetection?: boolean): Promise<void>;
  ingestChunk(consultationId: string, chunk: Buffer): void;
  getTranscript(consultationId: string): string;
  endSession(consultationId: string): Promise<string>;
  clearTranscript(consultationId: string): void;
  startBatchTranscription(consultationId: string, audioFilePath: string, languageCode: string, clientWs?: WebSocket): Promise<void>;
}

class HybridTranscriptionService implements TranscriptionService {
  private deepgramService: DeepgramTranscriptionService;
  private elevenLabsBatchService: ElevenLabsBatchService;
  private awsTranscribeBatchService: AWSTranscribeBatchService;
  private activeService: Map<string, 'deepgram'> = new Map();

  constructor() {
    this.deepgramService = new DeepgramTranscriptionService();
    this.elevenLabsBatchService = new ElevenLabsBatchService();
    this.awsTranscribeBatchService = new AWSTranscribeBatchService();
  }

  async startSession(consultationId: string, clientWs: WebSocket, language: ConsultationLanguage, enableLanguageDetection: boolean = false): Promise<void> {
    // ElevenLabs batch mode languages (bn, th, ms, auto) are handled separately in WebSocket server
    // Only route English to Deepgram realtime streaming
    const useElevenLabsBatch = ['bn', 'th', 'ms', 'auto'].includes(language);
    
    if (useElevenLabsBatch) {
      // This should not be called for ElevenLabs batch languages - batch mode is handled in WebSocket server
      throw new Error(`${language} consultations use ElevenLabs batch mode, not realtime streaming`);
    } else {
      // Route only English to Deepgram realtime
      console.log(`[TRANSCRIPTION] Routing ${language} consultation ${consultationId} to Deepgram (realtime)`);
      this.activeService.set(consultationId, 'deepgram');
      return this.deepgramService.startSession(consultationId, clientWs, language, enableLanguageDetection);
    }
  }

  async startBatchTranscription(consultationId: string, audioFilePath: string, languageCode: string, clientWs?: WebSocket): Promise<void> {
    // Get transcription configuration for this language
    const config = await TranscriptionConfig.findOne({ 
      language: languageCode,
      enabled: true 
    });

    if (!config) {
      throw new Error(`No transcription configuration found for language: ${languageCode}`);
    }

    // Route to appropriate cloud provider based on configuration
    const cloudProvider = config.cloudProvider;

    if (cloudProvider === 'aws') {
      console.log(`[TRANSCRIPTION] Routing ${languageCode} consultation ${consultationId} to AWS Transcribe (batch)`);
      return this.awsTranscribeBatchService.startBatchTranscription(consultationId, audioFilePath, languageCode, clientWs);
    } else if (cloudProvider === 'elevenlabs') {
      console.log(`[TRANSCRIPTION] Routing ${languageCode} consultation ${consultationId} to ElevenLabs (batch)`);
      return this.elevenLabsBatchService.startBatchTranscription(consultationId, audioFilePath, languageCode, clientWs);
    } else {
      // Default to ElevenLabs for backward compatibility
      console.log(`[TRANSCRIPTION] Defaulting to ElevenLabs for ${languageCode} consultation ${consultationId}`);
      return this.elevenLabsBatchService.startBatchTranscription(consultationId, audioFilePath, languageCode, clientWs);
    }
  }

  async processPartialRecording(
    consultationId: string,
    audioFilePath: string,
    startTime: number,
    languageCode: string,
    clientWs?: WebSocket
  ): Promise<void> {
    // Get transcription configuration for this language
    const config = await TranscriptionConfig.findOne({ 
      language: languageCode,
      enabled: true 
    });

    if (!config) {
      // Default to ElevenLabs for backward compatibility
      return this.elevenLabsBatchService.processPartialRecording(consultationId, audioFilePath, startTime, languageCode, clientWs);
    }

    // Route to appropriate cloud provider
    if (config.cloudProvider === 'aws') {
      // AWS Transcribe: Treat each periodic chunk as a complete recording
      console.log(`[TRANSCRIPTION] Processing partial recording with AWS Transcribe (treating chunk as complete recording)`);
      return this.awsTranscribeBatchService.processPartialRecording(consultationId, audioFilePath, startTime, languageCode, clientWs);
    } else {
      // ElevenLabs supports periodic transcription
      return this.elevenLabsBatchService.processPartialRecording(consultationId, audioFilePath, startTime, languageCode, clientWs);
    }
  }

  ingestChunk(consultationId: string, chunk: Buffer): void {
    const service = this.activeService.get(consultationId);
    if (service === 'deepgram') {
      this.deepgramService.ingestChunk(consultationId, chunk);
    }
    // Bengali consultations don't use ingestChunk - they use batch mode
  }

  getTranscript(consultationId: string): string {
    const service = this.activeService.get(consultationId);
    if (service === 'deepgram') {
      return this.deepgramService.getTranscript(consultationId);
    }
    // For batch mode, try both services (transcript is stored in database anyway)
    const elevenLabsTranscript = this.elevenLabsBatchService.getTranscript(consultationId);
    const awsTranscript = this.awsTranscribeBatchService.getTranscript(consultationId);
    return elevenLabsTranscript || awsTranscript;
  }

  async endSession(consultationId: string): Promise<string> {
    const service = this.activeService.get(consultationId);
    this.activeService.delete(consultationId);
    
    if (service === 'deepgram') {
      return this.deepgramService.endSession(consultationId);
    }
    // Bengali batch mode doesn't use endSession
    return '';
  }

  clearTranscript(consultationId: string): void {
    const service = this.activeService.get(consultationId);
    this.activeService.delete(consultationId);
    
    if (service === 'deepgram') {
      this.deepgramService.clearTranscript(consultationId);
    }
    // Bengali batch mode cleanup handled by batch service
  }
}

class DeepgramTranscriptionService {
  private deepgramApiKey: string;
  private sessions: Map<string, {
    deepgramConnection: any;
    clientWs: WebSocket;
    transcript: string;
    interimTranscript: string;
  }> = new Map();

  constructor() {
    this.deepgramApiKey = process.env.DEEPGRAM_API_KEY || '';
    if (!this.deepgramApiKey) {
      console.warn('DEEPGRAM_API_KEY not set. English transcription will not work.');
    }
  }

  async startSession(consultationId: string, clientWs: WebSocket, language: ConsultationLanguage, enableLanguageDetection: boolean = false): Promise<void> {
    if (!this.deepgramApiKey) {
      throw new Error('Deepgram API key not configured');
    }

    // Map language codes to Deepgram format
    // Deepgram supports: en-US, th, ms, and auto-detection
    let deepgramLanguage: string | undefined;
    if (language === 'en') {
      deepgramLanguage = 'en-US';
    } else if (language === 'th') {
      deepgramLanguage = 'th';
    } else if (language === 'ms') {
      deepgramLanguage = 'ms';
    } else if (language === 'auto') {
      // Deepgram will auto-detect if language is undefined
      deepgramLanguage = undefined;
    } else {
      // Default to English for unknown languages
      deepgramLanguage = 'en-US';
    }
    
    console.log(`[TRANSCRIPTION] Starting Deepgram session for consultation ${consultationId} with language: ${deepgramLanguage || 'auto-detect'}`);

    const deepgram = createClient(this.deepgramApiKey);
    const connectionOptions: any = {
      model: 'nova-2',
      smart_format: true,
      interim_results: true,
      punctuate: true,
      diarize: false,
    };
    
    // Only set language if specified (undefined means auto-detect)
    if (deepgramLanguage) {
      connectionOptions.language = deepgramLanguage;
    }
    
    const connection = deepgram.listen.live(connectionOptions);

    // Initialize session
    const session = {
      deepgramConnection: connection,
      clientWs,
      transcript: '',
      interimTranscript: '',
    };
    this.sessions.set(consultationId, session);

    connection.on(LiveTranscriptionEvents.Open, () => {
      console.log(`Deepgram connection opened for consultation ${consultationId}`);
    });

    connection.on(LiveTranscriptionEvents.Metadata, (metadata) => {
      console.log(`Deepgram metadata for ${consultationId}:`, metadata);
    });

    connection.on(LiveTranscriptionEvents.Transcript, (data) => {
      try {
        const transcriptText = data.channel?.alternatives?.[0]?.transcript || '';
        const isFinal = data.is_final || false;

        if (transcriptText) {
          if (isFinal) {
            // Append final transcript
            session.transcript += transcriptText + ' ';
            session.interimTranscript = '';
          } else {
            // Store interim result
            session.interimTranscript = transcriptText;
          }

          // Send update to client with current full transcript + latest interim
          const currentTranscript = session.transcript + (session.interimTranscript || '');

          clientWs.send(JSON.stringify({
            type: 'TRANSCRIPT_UPDATE',
            consultationId,
            transcript: currentTranscript.trim(),
            isFinal,
          }));
        }
      } catch (error) {
        console.error('Error processing Deepgram transcript:', error);
      }
    });

    connection.on(LiveTranscriptionEvents.Error, (error) => {
      console.error(`Deepgram error for consultation ${consultationId}:`, error);
      clientWs.send(JSON.stringify({
        type: 'TRANSCRIPT_ERROR',
        consultationId,
        error: 'Transcription error occurred',
      }));
    });

    connection.on(LiveTranscriptionEvents.Close, () => {
      console.log(`Deepgram connection closed for consultation ${consultationId}`);
    });

    // Keep connection alive
    connection.keepAlive();
  }

  ingestChunk(consultationId: string, chunk: Buffer): void {
    const session = this.sessions.get(consultationId);
    if (!session || !session.deepgramConnection) {
      console.warn(`No active Deepgram session for consultation ${consultationId}`);
      return;
    }

    try {
      session.deepgramConnection.send(chunk);
    } catch (error) {
      console.error(`Error sending chunk to Deepgram for ${consultationId}:`, error);
    }
  }

  getTranscript(consultationId: string): string {
    const session = this.sessions.get(consultationId);
    return session?.transcript || '';
  }

  async endSession(consultationId: string): Promise<string> {
    const session = this.sessions.get(consultationId);
    if (!session) {
      return '';
    }

    try {
      // Finish the Deepgram connection
      if (session.deepgramConnection) {
        await session.deepgramConnection.finish();
      }

      const finalTranscript = session.transcript.trim();
      this.sessions.delete(consultationId);
      return finalTranscript;
    } catch (error) {
      console.error(`Error ending Deepgram session for ${consultationId}:`, error);
      const finalTranscript = session.transcript.trim();
      this.sessions.delete(consultationId);
      return finalTranscript;
    }
  }

  clearTranscript(consultationId: string): void {
    this.sessions.delete(consultationId);
  }
}

export const transcriptionService = new HybridTranscriptionService();
