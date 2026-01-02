import { WebSocket } from 'ws';
import Consultation from '../models/Consultation';

interface ElevenLabsSession {
  ws: WebSocket;
  clientWs: WebSocket;
  transcript: string;
  interimTranscript: string;
  lastSavedTranscript: string; // Track last saved transcript to avoid unnecessary saves
  saveTimer?: NodeJS.Timeout; // Timer for periodic saves
}

export class ElevenLabsTranscriptionService {
  private apiKey: string;
  private sessions: Map<string, ElevenLabsSession> = new Map();

  constructor() {
    this.apiKey = process.env.ELEVENLABS_API_KEY || '';
    if (!this.apiKey) {
      console.warn('ELEVENLABS_API_KEY not set. Bengali transcription will not work.');
    }
  }

  async startSession(consultationId: string, clientWs: WebSocket, enableLanguageDetection: boolean = false): Promise<void> {
    if (!this.apiKey) {
      throw new Error('Eleven Labs API key not configured');
    }

    console.log(`[TRANSCRIPTION] Starting Eleven Labs session for consultation ${consultationId} (Bengali, language detection: ${enableLanguageDetection})`);

    // Eleven Labs Scribe v2 Realtime WebSocket endpoint
    // Build query parameters
    const params = new URLSearchParams({
      model_id: 'scribe_v2_realtime',
      language_code: 'bn',
      audio_format: 'pcm_16000',
      commit_strategy: 'manual',
    });
    
    // Add language detection if enabled
    if (enableLanguageDetection) {
      params.append('include_language_detection', 'true');
    }
    
    const wsUrl = `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${params.toString()}`;
    
    const ws = new WebSocket(wsUrl, {
      headers: {
        'xi-api-key': this.apiKey,
      },
    });

    const session: ElevenLabsSession = {
      ws,
      clientWs,
      transcript: '',
      interimTranscript: '',
      lastSavedTranscript: '',
    };

    this.sessions.set(consultationId, session);
    
    // Set up periodic transcript saving (every 10 seconds) to prevent loss
    session.saveTimer = setInterval(async () => {
      const currentTranscript = session.transcript.trim();
      if (currentTranscript && currentTranscript !== session.lastSavedTranscript && currentTranscript.length > 0) {
        try {
          const consultation = await Consultation.findById(consultationId);
          if (consultation) {
            // Only update if new transcript is longer
            const existingTranscript = consultation.transcript || '';
            if (currentTranscript.length > existingTranscript.length) {
              consultation.transcript = currentTranscript;
              await consultation.save();
              session.lastSavedTranscript = currentTranscript;
              console.log(`[ELEVENLABS] Periodically saved transcript for consultation ${consultationId}, length: ${currentTranscript.length} characters`);
            }
          }
        } catch (error) {
          console.error(`[ELEVENLABS] Error in periodic save for consultation ${consultationId}:`, error);
        }
      }
    }, 10000); // Save every 10 seconds

    ws.on('open', () => {
      console.log(`Eleven Labs connection opened for consultation ${consultationId}`);
      // Session is started automatically by Eleven Labs, no config message needed
    });

    ws.on('message', (data: Buffer) => {
      try {
        const messageStr = data.toString();
        console.log(`[ELEVENLABS] Received message from Eleven Labs for consultation ${consultationId}:`, messageStr.substring(0, 200));
        
        const message = JSON.parse(messageStr);
        
        // Handle session_started message
        if (message.message_type === 'session_started') {
          console.log(`[ELEVENLABS] Session started for consultation ${consultationId}, session_id: ${message.session_id}`);
          console.log(`[ELEVENLABS] Config:`, JSON.stringify(message.config, null, 2));
          return;
        }
        
        // Handle partial transcript (interim results)
        if (message.message_type === 'partial_transcript') {
          const transcriptText = message.text || '';
          console.log(`[ELEVENLABS] Partial transcript for ${consultationId}: "${transcriptText}"`);
          
          if (transcriptText) {
            session.interimTranscript = transcriptText;
            
            // Send update to client
            const currentTranscript = session.transcript + (session.interimTranscript || '');

            clientWs.send(JSON.stringify({
              type: 'TRANSCRIPT_UPDATE',
              consultationId,
              transcript: currentTranscript.trim(),
              isFinal: false,
            }));
          }
        }
        
        // Handle committed transcript (final results)
        if (message.message_type === 'committed_transcript' || message.message_type === 'committed_transcript_with_timestamps') {
          let transcriptText = '';
          let detectedLanguage: string | null = null;
          
          // Extract text from transcript array if available
          if (message.transcript && Array.isArray(message.transcript)) {
            transcriptText = message.transcript.map((item: any) => item.word || item.text || '').join(' ');
          } else if (message.text) {
            transcriptText = message.text;
          }
          
          // Extract detected language if available (from committed_transcript_with_timestamps)
          if (message.message_type === 'committed_transcript_with_timestamps' && message.language_code) {
            detectedLanguage = message.language_code;
            console.log(`[ELEVENLABS] Detected language for ${consultationId}: ${detectedLanguage}`);
            
            // Log warning if detected language doesn't match expected Bengali
            if (detectedLanguage !== 'bn') {
              console.warn(`[ELEVENLABS] Language mismatch! Expected 'bn', detected '${detectedLanguage}'`);
            }
          }
          
          console.log(`[ELEVENLABS] Committed transcript for ${consultationId}: "${transcriptText}"`);
          
          if (transcriptText) {
            session.transcript += transcriptText + ' ';
            session.interimTranscript = '';

            // Send update to client with detected language if available
            const currentTranscript = session.transcript.trim();
            const updateMessage: any = {
              type: 'TRANSCRIPT_UPDATE',
              consultationId,
              transcript: currentTranscript,
              isFinal: true,
            };
            
            // Include detected language if available
            if (detectedLanguage) {
              updateMessage.detectedLanguage = detectedLanguage;
            }

            clientWs.send(JSON.stringify(updateMessage));
          }
        }
        
        // Handle errors and quota exceeded
        if (message.message_type === 'error' || message.message_type === 'quota_exceeded') {
          console.error(`[ELEVENLABS] Error for consultation ${consultationId}:`, JSON.stringify(message, null, 2));
          
          // Save current transcript before closing (even if error occurred)
          const currentTranscript = session.transcript.trim();
          if (currentTranscript) {
            console.log(`[ELEVENLABS] Saving transcript before error close, length: ${currentTranscript.length} characters`);
            // Send final transcript update to client
            clientWs.send(JSON.stringify({
              type: 'TRANSCRIPT_UPDATE',
              consultationId,
              transcript: currentTranscript,
              isFinal: true,
            }));
          }
          
          clientWs.send(JSON.stringify({
            type: 'TRANSCRIPT_ERROR',
            consultationId,
            error: message.error_message || message.error || 'Transcription error occurred',
          }));
        }
        
        // Handle quota_exceeded - save transcript before closing
        if (message.message_type === 'quota_exceeded') {
          console.warn(`[ELEVENLABS] Quota exceeded for consultation ${consultationId}, saving current transcript`);
          
          // Save current transcript before closing
          const currentTranscript = session.transcript.trim();
          if (currentTranscript) {
            console.log(`[ELEVENLABS] Saving transcript before quota exceeded close, length: ${currentTranscript.length} characters`);
            // Send final transcript update to client
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({
                type: 'TRANSCRIPT_UPDATE',
                consultationId,
                transcript: currentTranscript,
                isFinal: true,
              }));
            }
          }
          
          // Notify client about quota error
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({
              type: 'TRANSCRIPT_ERROR',
              consultationId,
              error: 'Eleven Labs quota exceeded. Current transcript has been saved.',
            }));
          }
          
          // Close the connection
          session.ws.close();
          return;
        }
        
        // Log any other message types for debugging
        if (!['session_started', 'partial_transcript', 'committed_transcript', 'committed_transcript_with_timestamps', 'error', 'quota_exceeded'].includes(message.message_type)) {
          console.log(`[ELEVENLABS] Unknown message type for ${consultationId}: ${message.message_type}`, JSON.stringify(message, null, 2));
        }
      } catch (error) {
        console.error(`[ELEVENLABS] Error processing message for ${consultationId}:`, error);
        console.error(`[ELEVENLABS] Raw message:`, data.toString().substring(0, 500));
      }
    });

    ws.on('error', (error) => {
      console.error(`Eleven Labs WebSocket error for consultation ${consultationId}:`, error);
      clientWs.send(JSON.stringify({
        type: 'TRANSCRIPT_ERROR',
        consultationId,
        error: 'Eleven Labs connection error',
      }));
    });

    ws.on('close', () => {
      console.log(`Eleven Labs connection closed for consultation ${consultationId}`);
      
      // Ensure transcript is saved even if connection closes unexpectedly
      const currentTranscript = session.transcript.trim();
      if (currentTranscript) {
        console.log(`[ELEVENLABS] Connection closed, saving transcript: ${currentTranscript.length} characters`);
        // Send final transcript update to client before closing
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({
            type: 'TRANSCRIPT_UPDATE',
            consultationId,
            transcript: currentTranscript,
            isFinal: true,
          }));
        }
      }
    });
  }

  ingestChunk(consultationId: string, chunk: Buffer): void {
    const session = this.sessions.get(consultationId);
    if (!session || !session.ws) {
      console.warn(`[ELEVENLABS] No active session for consultation ${consultationId}`);
      return;
    }

    if (session.ws.readyState !== WebSocket.OPEN) {
      console.warn(`[ELEVENLABS] WebSocket not open for consultation ${consultationId}, state: ${session.ws.readyState}`);
      return;
    }

    try {
      // Eleven Labs expects PCM audio in base64 format
      // The client now sends PCM16 (Int16Array) audio data
      // Convert PCM buffer to base64
      const audioBase64 = chunk.toString('base64');
      
      // Send as JSON message according to Eleven Labs API format
      // PCM16 audio at 16kHz sample rate (as configured in client)
      const message = {
        message_type: 'input_audio_chunk',
        audio_base_64: audioBase64,
        commit: false, // Set to true to force commit, false for streaming
        sample_rate: 16000, // PCM audio from client is 16kHz
      };
      
      session.ws.send(JSON.stringify(message));
      
      // Log occasionally to avoid spam (every 20th chunk)
      if (Math.random() < 0.05) {
        console.log(`[ELEVENLABS] Sent audio chunk to Eleven Labs, PCM size: ${chunk.length} bytes, base64: ${audioBase64.length} chars`);
      }
    } catch (error) {
      console.error(`[ELEVENLABS] Error sending chunk to Eleven Labs for ${consultationId}:`, error);
    }
  }

  getTranscript(consultationId: string): string {
    const session = this.sessions.get(consultationId);
    return session?.transcript || '';
  }

  async endSession(consultationId: string): Promise<string> {
    const session = this.sessions.get(consultationId);
    if (!session) {
      console.log(`[ELEVENLABS] No session found for consultation ${consultationId}`);
      return '';
    }

    try {
      // Clear periodic save timer
      if (session.saveTimer) {
        clearInterval(session.saveTimer);
        session.saveTimer = undefined;
      }

      // Get current transcript before closing (in case connection already closed)
      const currentTranscript = session.transcript.trim();
      console.log(`[ELEVENLABS] Ending session for consultation ${consultationId}, current transcript length: ${currentTranscript.length} characters`);

      // Send commit message to finalize any pending transcriptions (if connection still open)
      if (session.ws && session.ws.readyState === WebSocket.OPEN) {
        try {
          // Send empty chunk with commit=true to finalize
          session.ws.send(JSON.stringify({
            message_type: 'input_audio_chunk',
            audio_base_64: '',
            commit: true,
            sample_rate: 16000,
          }));
          
          // Wait a bit for final transcriptions, then close
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Check if we got any final transcript updates
          const updatedTranscript = session.transcript.trim();
          if (updatedTranscript.length > currentTranscript.length) {
            console.log(`[ELEVENLABS] Received final transcript updates, new length: ${updatedTranscript.length} characters`);
          }
        } catch (error) {
          console.error(`[ELEVENLABS] Error sending commit message:`, error);
        }
        
        // Close connection if still open
        if (session.ws.readyState === WebSocket.OPEN) {
          session.ws.close();
        }
      }

      // Final save before ending session
      const finalTranscript = session.transcript.trim();
      if (finalTranscript && finalTranscript !== session.lastSavedTranscript) {
        try {
          const consultation = await Consultation.findById(consultationId);
          if (consultation) {
            const existingTranscript = consultation.transcript || '';
            if (finalTranscript.length > existingTranscript.length) {
              consultation.transcript = finalTranscript;
              await consultation.save();
              console.log(`[ELEVENLABS] Final save for consultation ${consultationId}, length: ${finalTranscript.length} characters`);
            }
          }
        } catch (error) {
          console.error(`[ELEVENLABS] Error in final save:`, error);
        }
      }

      console.log(`[ELEVENLABS] Final transcript for consultation ${consultationId}: ${finalTranscript.length} characters`);
      
      this.sessions.delete(consultationId);
      return finalTranscript;
    } catch (error) {
      console.error(`[ELEVENLABS] Error ending session for consultation ${consultationId}:`, error);
      // Always return transcript even on error
      const finalTranscript = session.transcript.trim();
      
      // Try to save transcript even on error
      if (finalTranscript) {
        try {
          const consultation = await Consultation.findById(consultationId);
          if (consultation) {
            consultation.transcript = finalTranscript;
            await consultation.save();
            console.log(`[ELEVENLABS] Saved transcript on error for consultation ${consultationId}`);
          }
        } catch (saveError) {
          console.error(`[ELEVENLABS] Failed to save transcript on error:`, saveError);
        }
      }
      
      this.sessions.delete(consultationId);
      return finalTranscript;
    }
  }

  clearTranscript(consultationId: string): void {
    const session = this.sessions.get(consultationId);
    if (session) {
      // Clear periodic save timer
      if (session.saveTimer) {
        clearInterval(session.saveTimer);
      }
      if (session.ws) {
        session.ws.close();
      }
    }
    this.sessions.delete(consultationId);
  }
}

