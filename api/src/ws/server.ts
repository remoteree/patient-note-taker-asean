import { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import Consultation from '../models/Consultation';
import { transcriptionService } from '../services/transcriptionService';
import { JWT_SECRET } from '../config/jwt';

interface WebSocketMessage {
  type: string;
  consultationId?: string;
  transcript?: string;
}

export const setupWebSocketServer = (server: Server) => {
  const wss = new WebSocketServer({ server, path: '/ws/consultations' });

  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const consultationId = url.searchParams.get('consultationId');
    const token = url.searchParams.get('token') || 
                  req.headers.cookie?.split('token=')[1]?.split(';')[0];

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

        // Start transcription session with Deepgram
        transcriptionService.startSession(consultationId, ws)
          .catch((error) => {
            console.error('Error starting transcription session:', error);
            ws.send(JSON.stringify({
              type: 'TRANSCRIPT_ERROR',
              consultationId,
              error: 'Failed to start transcription',
            }));
          });

        // Handle binary audio chunks
        ws.on('message', async (data: Buffer) => {
          try {
            // Send audio chunk to transcription service
            transcriptionService.ingestChunk(consultationId, data);
          } catch (error) {
            console.error('Error processing audio chunk:', error);
          }
        });

        // Handle connection close
        ws.on('close', async () => {
          try {
            // End transcription session and get final transcript
            const finalTranscript = await transcriptionService.endSession(consultationId);

            // Persist transcript to database (encryption handled by model pre-save hook)
            if (finalTranscript) {
              const consultation = await Consultation.findById(consultationId);
              if (consultation) {
                consultation.transcript = finalTranscript;
                await consultation.save(); // This will trigger encryption
              }
            }
          } catch (error) {
            console.error('Error finalizing transcript:', error);
          }
        });

        ws.on('error', (error) => {
          console.error('WebSocket error:', error);
        });
      })
      .catch((error) => {
        console.error('Error verifying consultation:', error);
        ws.close(1011, 'Server error');
      });
  });

  return wss;
};

