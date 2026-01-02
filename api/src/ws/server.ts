import { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import Consultation from '../models/Consultation';
import TranscriptionConfig from '../models/TranscriptionConfig';
import { transcriptionService } from '../services/transcriptionService';
import { AudioRecordingService } from '../services/audioRecordingService';
import { JWT_SECRET } from '../config/jwt';
import { generateSummariesInBackground } from '../services/noteService';

interface WebSocketMessage {
  type: string;
  consultationId?: string;
  transcript?: string;
}

export const setupWebSocketServer = (server: Server) => {
  const wss = new WebSocketServer({ server, path: '/ws/consultations' });
  const audioRecordingService = new AudioRecordingService();

  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const consultationId = url.searchParams.get('consultationId');
    const token = url.searchParams.get('token') || 
                  req.headers.cookie?.split('token=')[1]?.split(';')[0];
    const enableLanguageDetection = url.searchParams.get('enableLanguageDetection') === 'true';

    if (!token) {
      ws.close(1008, 'Authentication required');
      return;
    }

    if (!consultationId) {
      ws.close(1008, 'Consultation ID required');
      return;
    }

    let userId: string;
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
      userId = decoded.userId;
    } catch (error) {
      ws.close(1008, 'Invalid token');
      return;
    }

    // Verify consultation belongs to user and is in_progress
    Consultation.findOne({ _id: consultationId, userId })
      .then((consultation) => {
        if (!consultation) {
          ws.close(1008, 'Consultation not found');
          return;
        }

        if (consultation.status !== 'in_progress') {
          ws.close(1008, 'Consultation is not in progress');
          return;
        }

        // Send initial transcript if exists
        if (consultation.transcript) {
          ws.send(JSON.stringify({
            type: 'TRANSCRIPT_UPDATE',
            consultationId,
            transcript: consultation.transcript,
          }));
        }

        // Get transcription configuration for this language
        TranscriptionConfig.findOne({ 
          language: consultation.language,
          enabled: true 
        }).then((config) => {
          if (!config) {
            console.warn(`[WS] No transcription config found for language: ${consultation.language}, defaulting to Deepgram`);
            // Default to Deepgram realtime for English, batch for others
            const useBatch = consultation.language !== 'en';
            if (useBatch) {
              handleBatchMode(consultation, ws, consultation.language);
            } else {
              handleRealtimeMode(consultation, ws, enableLanguageDetection);
            }
            return;
          }

          // Determine mode based on cloud provider
          // Deepgram supports realtime streaming, others use batch
          const useBatch = config.cloudProvider !== 'deepgram';
          
          if (useBatch) {
            handleBatchMode(consultation, ws, consultation.language, config.cloudProvider);
          } else {
            handleRealtimeMode(consultation, ws, enableLanguageDetection);
          }
        }).catch((error) => {
          console.error(`[WS] Error fetching transcription config:`, error);
          // Fallback to default behavior
          const useBatch = ['bn', 'th', 'ms', 'auto'].includes(consultation.language);
          if (useBatch) {
            handleBatchMode(consultation, ws, consultation.language);
          } else {
            handleRealtimeMode(consultation, ws, enableLanguageDetection);
          }
        });
      })
      .catch((error) => {
        console.error('Error finding consultation:', error);
        ws.close(1008, 'Error finding consultation');
      });

    // Helper function for batch mode
    function handleBatchMode(
      consultation: any,
      ws: WebSocket,
      languageCode: string,
      cloudProvider: string = 'elevenlabs'
    ) {
      const consultationId = consultation._id.toString();
      // Start audio recording for batch transcription
      const languageName = consultation.language === 'bn' ? 'Bengali' : 
                          consultation.language === 'th' ? 'Thai' : 
                          consultation.language === 'ms' ? 'Malay' : 'Auto-detect';
      const providerName = cloudProvider === 'aws' ? 'AWS Transcribe' : 
                          cloudProvider === 'elevenlabs' ? 'ElevenLabs' : 
                          cloudProvider === 'deepgram' ? 'Deepgram' : 'Unknown';
      console.log(`[WS] Starting audio recording for ${languageName} consultation ${consultationId} (${providerName} batch mode)`);
      audioRecordingService.startRecording(consultationId);
      
      // Map consultation language code
      const transcriptionLanguageCode = consultation.language === 'auto' ? 'bn' : consultation.language;
      
      // Set up periodic transcription during recording (every 30 seconds)
      // Both AWS Transcribe and ElevenLabs support this - AWS treats each chunk as a complete recording
      const transcriptionInterval = setInterval(async () => {
        try {
          const session = audioRecordingService.getSession(consultationId);
          if (!session) {
            clearInterval(transcriptionInterval);
            return;
          }
          
          // Check if we have enough new audio to process (at least 30 seconds)
          const currentDuration = (Date.now() - session.startTime.getTime()) / 1000;
          const unprocessedDuration = currentDuration - session.processedDuration;
          
          if (unprocessedDuration >= 30) {
            console.log(`[WS] Processing periodic transcription for ${consultationId}, ${unprocessedDuration.toFixed(1)}s of new audio (${providerName})`);
            
            // Create snapshot of current recording
            const snapshotPath = await audioRecordingService.createSnapshot(consultationId);
            if (!snapshotPath) {
              console.log(`[WS] No audio data to process yet for ${consultationId}`);
              return;
            }
            
            try {
              // Process the snapshot (from processedDuration to end of snapshot)
              // For AWS Transcribe, this treats the snapshot as a complete recording
              // For ElevenLabs, this processes the incremental chunk
              await transcriptionService.processPartialRecording(
                consultationId,
                snapshotPath,
                session.processedDuration,
                transcriptionLanguageCode,
                ws
              );
              
              // Update processed duration only if transcription succeeded
              session.processedDuration = currentDuration;
              session.lastProcessedTime = Date.now();
            } catch (error: any) {
              // Check if error is due to audio being too short (expected when user stops talking)
              const errorMessage = error.message || '';
              if (errorMessage.includes('too small') || errorMessage.includes('Minimum audio duration')) {
                // This is expected when user stops talking - update processed duration and continue
                console.log(`[WS] Audio segment too short for ${consultationId}, updating processed duration and continuing`);
                session.processedDuration = currentDuration;
                session.lastProcessedTime = Date.now();
              } else {
                // Re-throw other errors to be handled below
                throw error;
              }
            } finally {
              // Always cleanup snapshot file
              const { unlink } = await import('fs/promises');
              await unlink(snapshotPath).catch(console.error);
            }
          }
        } catch (error: any) {
          // Check if error is due to audio being too short - if so, just log and continue
          const errorMessage = error.message || '';
          if (errorMessage.includes('too small') || errorMessage.includes('Minimum audio duration')) {
            console.log(`[WS] Audio segment too short for ${consultationId} (user may have stopped talking), continuing...`);
            // Update processed duration to prevent retrying the same segment
            const session = audioRecordingService.getSession(consultationId);
            if (session) {
              const currentDuration = (Date.now() - session.startTime.getTime()) / 1000;
              session.processedDuration = currentDuration;
              session.lastProcessedTime = Date.now();
            }
            return; // Continue interval without error
          }
          
          console.error(`[WS] Error in periodic transcription for ${consultationId}:`, error);
          
          // If transcription fails and no transcript exists, auto-delete the consultation
          try {
            const consultation = await Consultation.findById(consultationId);
            if (consultation) {
              const transcript = consultation.transcript || '';
              const hasTranscript = transcript.trim().length > 0;
              
              if (!hasTranscript) {
                console.log(`[WS] Auto-deleting consultation ${consultationId} - transcription failed and no transcript exists`);
                
                // Cancel recording session
                audioRecordingService.cancelRecording(consultationId);
                
                // Delete consultation
                await Consultation.findByIdAndDelete(consultationId);
                
                // Clear interval and close WebSocket
                clearInterval(transcriptionInterval);
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({
                    type: 'TRANSCRIPT_ERROR',
                    consultationId,
                    error: 'Transcription failed and consultation was automatically deleted',
                  }));
                  ws.close();
                }
                
                console.log(`[WS] Consultation ${consultationId} deleted due to transcription failure`);
                return; // Exit the interval function
              }
            }
          } catch (deleteError) {
            console.error(`[WS] Error auto-deleting consultation ${consultationId}:`, deleteError);
          }
          
          // Don't clear interval - continue trying if transcript exists
        }
      }, 30000); // Check every 30 seconds
      
      // Store interval so we can clear it when connection closes
      (ws as any).transcriptionInterval = transcriptionInterval;
      
      // Handle binary audio chunks - record them instead of streaming
      ws.on('message', async (data: Buffer) => {
        try {
          // Record audio chunk to file
          audioRecordingService.writeChunk(consultationId, data);
          
          // Log occasionally to avoid spam
          if (Math.random() < 0.02) {
            console.log(`[WS] Recorded audio chunk for consultation ${consultationId}, size: ${data.length} bytes`);
          }
        } catch (error) {
          console.error(`[WS] Error recording audio chunk for ${consultationId}:`, error);
        }
      });
    }

    // Helper function for realtime mode
    function handleRealtimeMode(consultation: any, ws: WebSocket, enableLanguageDetection: boolean) {
      const consultationId = consultation._id.toString();
      // For Deepgram, use realtime streaming
      transcriptionService.startSession(consultationId, ws, consultation.language, enableLanguageDetection)
        .catch((error) => {
          console.error('Error starting transcription session:', error);
          ws.send(JSON.stringify({
            type: 'TRANSCRIPT_ERROR',
            consultationId,
            error: 'Failed to start transcription',
          }));
        });

      // Handle binary audio chunks - stream to transcription service
      ws.on('message', async (data: Buffer) => {
        try {
          if (Math.random() < 0.02) {
            console.log(`[WS] Received audio chunk for consultation ${consultationId}, size: ${data.length} bytes`);
          }
          transcriptionService.ingestChunk(consultationId, data);
        } catch (error) {
          console.error(`[WS] Error processing audio chunk for ${consultationId}:`, error);
        }
      });
    }

    // Handle connection close
    ws.on('close', async () => {
      try {
        console.log(`[WS] Connection closed for consultation ${consultationId}`);
        
        // Clear periodic transcription interval if it exists
        if ((ws as any).transcriptionInterval) {
          clearInterval((ws as any).transcriptionInterval);
        }
        
        const consultation = await Consultation.findById(consultationId);
        if (!consultation) {
          return;
        }

        // Get transcription config to determine provider
        const config = await TranscriptionConfig.findOne({ 
          language: consultation.language,
          enabled: true 
        });
        
        const useBatch = !config || config.cloudProvider !== 'deepgram';
        
        if (useBatch) {
              // For ElevenLabs batch mode: Stop recording and trigger final batch transcription
              try {
                const audioFilePath = await audioRecordingService.stopRecording(consultationId);
                console.log(`[WS] Audio recording stopped for ${consultationId}, file: ${audioFilePath}`);
                
                // Map consultation language code
                const transcriptionLanguageCode = consultation.language === 'auto' ? 'bn' : consultation.language;
                
                // Process any remaining unprocessed audio
                const session = audioRecordingService.getSession(consultationId);
                if (session && session.processedDuration > 0) {
                  // Process the final segment
                  await transcriptionService.processPartialRecording(
                    consultationId,
                    audioFilePath,
                    session.processedDuration,
                    transcriptionLanguageCode,
                    ws
                  ).catch(console.error);
                }
                
                // Trigger final batch transcription for any remaining audio
                // Pass WebSocket so it can send progress updates (WebSocket will stay open)
                transcriptionService.startBatchTranscription(consultationId, audioFilePath, transcriptionLanguageCode, ws)
                  .catch((error) => {
                    console.error(`[WS] Error starting batch transcription for ${consultationId}:`, error);
                    // Send error to client if WebSocket still open
                    if (ws.readyState === WebSocket.OPEN) {
                      ws.send(JSON.stringify({
                        type: 'TRANSCRIPT_ERROR',
                        consultationId,
                        error: 'Failed to start batch transcription',
                      }));
                    }
                  });
              } catch (error) {
                console.error(`[WS] Error stopping recording for ${consultationId}:`, error);
                audioRecordingService.cancelRecording(consultationId);
              }
            } else {
              // For other languages: End realtime transcription session
              const finalTranscript = await transcriptionService.endSession(consultationId);

              // Persist transcript to database
              if (finalTranscript && finalTranscript.trim().length > 0) {
                const existingTranscript = consultation.transcript || '';
                
                if (finalTranscript.length > existingTranscript.length || 
                    (finalTranscript.length > 0 && existingTranscript.length === 0)) {
                  consultation.transcript = finalTranscript;
                  await consultation.save();
                  console.log(`[WS] Saved transcript to database for consultation ${consultationId}, length: ${finalTranscript.length} characters`);
                  
                  // Trigger background summary generation
                  const detectedLanguage = consultation.detectedLanguage || consultation.language;
                  generateSummariesInBackground(consultationId, finalTranscript, detectedLanguage);
                }
              }
            }
          } catch (error) {
            console.error(`[WS] Error finalizing consultation ${consultationId}:`, error);
          }
        });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  return wss;
};

