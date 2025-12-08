import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { WebSocket } from 'ws';

export interface TranscriptionService {
  startSession(consultationId: string, clientWs: WebSocket): Promise<void>;
  ingestChunk(consultationId: string, chunk: Buffer): void;
  getTranscript(consultationId: string): string;
  endSession(consultationId: string): Promise<string>;
  clearTranscript(consultationId: string): void;
}

class DeepgramTranscriptionService implements TranscriptionService {
  private deepgramApiKey: string;
  private sessions: Map<string, {
    deepgramConnection: any;
    clientWs: WebSocket;
    transcript: string;
    interimTranscript: string;
  }> = new Map();

  constructor() {
    console.log('\n[DeepgramTranscriptionService] Initializing...');
    console.log(`[DeepgramTranscriptionService] Checking DEEPGRAM_API_KEY from process.env...`);
    const envValue = process.env.DEEPGRAM_API_KEY;
    console.log(`[DeepgramTranscriptionService] process.env.DEEPGRAM_API_KEY type: ${typeof envValue}`);
    console.log(`[DeepgramTranscriptionService] process.env.DEEPGRAM_API_KEY exists: ${envValue !== undefined}`);
    console.log(`[DeepgramTranscriptionService] process.env.DEEPGRAM_API_KEY is truthy: ${!!envValue}`);
    console.log(`[DeepgramTranscriptionService] process.env.DEEPGRAM_API_KEY length: ${envValue?.length || 0}`);
    
    this.deepgramApiKey = envValue || '';
    
    if (this.deepgramApiKey) {
      const masked = this.deepgramApiKey.length > 8 
        ? `${this.deepgramApiKey.substring(0, 4)}...${this.deepgramApiKey.substring(this.deepgramApiKey.length - 4)}` 
        : '***';
      console.log(`[DeepgramTranscriptionService] ✓ DEEPGRAM_API_KEY found (${masked}, length: ${this.deepgramApiKey.length})`);
    } else {
      console.warn('[DeepgramTranscriptionService] ✗ DEEPGRAM_API_KEY not set. Transcription will not work.');
      console.warn('[DeepgramTranscriptionService] Available env vars:', Object.keys(process.env).filter(k => k.includes('DEEPGRAM')));
    }
    console.log('[DeepgramTranscriptionService] Initialization complete\n');
  }

  async startSession(consultationId: string, clientWs: WebSocket): Promise<void> {
    if (!this.deepgramApiKey) {
      throw new Error('Deepgram API key not configured');
    }

    const deepgram = createClient(this.deepgramApiKey);
    const connection = deepgram.listen.live({
      model: 'nova-2',
      language: 'en-US',
      smart_format: true,
      interim_results: true,
      punctuate: true,
      diarize: false,
    });

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
      console.warn(`No active session for consultation ${consultationId}`);
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

export const transcriptionService = new DeepgramTranscriptionService();
