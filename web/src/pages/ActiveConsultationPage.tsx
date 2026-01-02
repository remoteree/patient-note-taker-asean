import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Container,
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  TextField,
  AppBar,
  Toolbar,
  IconButton,
  CircularProgress,
  Alert,
  Chip,
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  FormControlLabel,
  Switch,
} from '@mui/material';
import { ArrowBack, Mic, Stop, CheckCircle, Person, Info } from '@mui/icons-material';
import { consultationsApi } from '../api/consultations';
import { Consultation } from '../types';
import { tokenStorage } from '../api/client';

export default function ActiveConsultationPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [consultation, setConsultation] = useState<Consultation | null>(null);
  const [transcript, setTranscript] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [loading, setLoading] = useState(true);
  const [generatingNote, setGeneratingNote] = useState(false);
  const [error, setError] = useState('');
  const [noteGenerated, setNoteGenerated] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<{ sendAudioChunk: (chunk: ArrayBuffer) => void; closeConnection: () => void } | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  const recordingStartTimeRef = useRef<number | null>(null);
  const maxRecordingDuration = 3600; // 1 hour in seconds
  const [showRecordingLimitDialog, setShowRecordingLimitDialog] = useState(false);
  const [enableLanguageDetection, setEnableLanguageDetection] = useState(false);
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);

  // Convert Float32Array to Int16Array (PCM16) for audio streaming
  const convertFloat32ToInt16 = (buffer: Float32Array): ArrayBuffer => {
    const length = buffer.length;
    const int16Buffer = new Int16Array(length);
    for (let i = 0; i < length; i++) {
      // Clamp values to [-1, 1] and convert to 16-bit integer
      const s = Math.max(-1, Math.min(1, buffer[i]));
      int16Buffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Buffer.buffer;
  };

  // Get language display name
  const getLanguageDisplayName = (lang: string): string => {
    switch (lang) {
      case 'bn':
        return 'Bengali (বাংলা)';
      case 'en':
        return 'English';
      case 'th':
        return 'Thai (ไทย)';
      case 'ms':
        return 'Malay (Bahasa Melayu)';
      case 'auto':
        return 'Auto-detect';
      default:
        return lang;
    }
  };

  useEffect(() => {
    loadConsultation();
  }, [id]);

  useEffect(() => {
    if (isRecording) {
      intervalRef.current = setInterval(() => {
        setRecordingTime((prev) => {
          const newTime = prev + 1;
          // Check if recording has exceeded 1 hour
          if (newTime >= maxRecordingDuration) {
            console.log(`[RECORDING] Maximum recording duration (${maxRecordingDuration}s) reached, stopping recording`);
            // Stop recording first, then show dialog
            
            // Stop Web Audio API (cloud mode)
            if (audioProcessorRef.current) {
              audioProcessorRef.current.disconnect();
              audioProcessorRef.current = null;
            }
            if (audioContextRef.current) {
              audioContextRef.current.close().catch(console.error);
              audioContextRef.current = null;
            }
            
            // Stop media stream
            if (mediaStreamRef.current) {
              mediaStreamRef.current.getTracks().forEach((track) => track.stop());
              mediaStreamRef.current = null;
            }
            
            if (wsRef.current) {
              wsRef.current.closeConnection();
              wsRef.current = null;
            }
            setIsRecording(false);
            setWsConnected(false);
            recordingStartTimeRef.current = null;
            
            // Reload consultation to get the final transcript
            if (id) {
              setTimeout(() => {
                loadConsultation();
              }, 500);
            }
            
            setShowRecordingLimitDialog(true);
            return maxRecordingDuration;
          }
          return newTime;
        });
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isRecording]);

  const loadConsultation = async () => {
    if (!id) return;
    try {
      const response = await consultationsApi.getConsultation(id);
      setConsultation(response.consultation);
      
      // Always preserve transcript - merge saved and current transcript
      const savedTranscript = response.consultation.transcript || '';
      const currentTranscript = transcript || '';
      
      if (savedTranscript) {
        console.log(`[CONSULTATION] Loaded saved transcript, length: ${savedTranscript.length} characters`);
        
        // If we have a current transcript that's longer or different, use the longer one
        // This handles the case where transcript is still being saved
        if (currentTranscript && currentTranscript.length > savedTranscript.length) {
          console.log(`[CONSULTATION] Current transcript is longer (${currentTranscript.length} vs ${savedTranscript.length}), keeping current`);
          // Keep current transcript - it will be saved when connection closes
        } else {
          setTranscript(savedTranscript);
        }
      } else if (currentTranscript) {
        // No saved transcript but we have current - keep it
        console.log(`[CONSULTATION] No saved transcript, keeping current transcript (${currentTranscript.length} chars)`);
        // Don't clear - keep current transcript
      } else {
        // No transcript at all - safe to clear
        setTranscript('');
      }
      
      setNoteGenerated(!!(response.consultation.doctorSummary || response.consultation.patientNote));
    } catch (err: any) {
      setError(err.message || 'Failed to load consultation');
    } finally {
      setLoading(false);
    }
  };

  const handleTranscriptUpdate = (newTranscript: string) => {
    // Always update transcript - never clear it
    if (newTranscript && newTranscript.trim().length > 0) {
      console.log(`[TRANSCRIPT] Updating transcript, new length: ${newTranscript.length} characters`);
      setTranscript(newTranscript);
    } else {
      console.log(`[TRANSCRIPT] Received empty transcript update, keeping existing transcript`);
      // Don't clear transcript if empty update received
    }
  };

  const startRecording = async () => {
    if (!id) return;

    try {
      console.log(`[RECORDING] Starting recording for consultation ${id}`);
      recordingStartTimeRef.current = Date.now();
      // Reset detected language when starting new recording
      setDetectedLanguage(null);

      // Use WebSocket for real-time transcription
        // Get token from localStorage (where it's stored after signup/login)
        const token = tokenStorage.get();

        if (!token) {
          setError('Authentication required');
          return;
        }

        // Connect WebSocket (use WSS for HTTPS, WS for HTTP)
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const languageDetectionParam = enableLanguageDetection ? '&enableLanguageDetection=true' : '';
        const wsUrl = `${protocol}//${window.location.host}/ws/consultations?consultationId=${id}&token=${token}${languageDetectionParam}`;
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          setWsConnected(true);
          setWsError(null);
          setTranscribing(true);
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            if (message.type === 'TRANSCRIPT_UPDATE' && message.transcript) {
              console.log(`[RECORDING] Received transcript update, length: ${message.transcript.length} characters${message.progress ? `, progress: ${message.progress}%` : ''}`);
              handleTranscriptUpdate(message.transcript);
              // Update detected language if provided
              if (message.detectedLanguage) {
                setDetectedLanguage(message.detectedLanguage);
              }
              // If transcription is complete (isFinal: true), close WebSocket
              if (message.isFinal) {
                console.log(`[RECORDING] Transcription complete, closing WebSocket`);
                setTranscribing(false);
                setTimeout(() => {
                  if (wsRef.current) {
                    wsRef.current.closeConnection();
                    wsRef.current = null;
                    setWsConnected(false);
                  }
                  // Reload consultation to get final saved transcript
                  loadConsultation();
                }, 1000);
              }
            } else if (message.type === 'TRANSCRIPT_ERROR') {
              console.error(`[RECORDING] Transcription error:`, message.error);
              setWsError(message.error || 'Transcription error occurred');
              setTranscribing(false);
              // Close WebSocket on error
              if (wsRef.current) {
                wsRef.current.closeConnection();
                wsRef.current = null;
                setWsConnected(false);
              }
              // Still reload consultation to get any saved transcript
              setTimeout(() => {
                loadConsultation();
              }, 1000);
            }
          } catch (err) {
            console.error('Error parsing WebSocket message:', err);
          }
        };

        ws.onerror = () => {
          setWsError('WebSocket connection error');
        };

        ws.onclose = () => {
          console.log(`[RECORDING] WebSocket closed, current transcript length: ${transcript.length} characters`);
          setWsConnected(false);
          setTranscribing(false);
          
          // Reload consultation to get the saved transcript from database
          // Wait a moment for server to finish saving (increased delay for reliability)
          setTimeout(() => {
            console.log(`[RECORDING] Reloading consultation after WebSocket close`);
            loadConsultation();
          }, 1500); // Increased delay to ensure server has time to save
        };

        wsRef.current = {
          sendAudioChunk: (chunk: ArrayBuffer) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(chunk);
            }
          },
          closeConnection: () => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.close();
            }
          },
        };

        // For cloud mode, use Web Audio API to capture PCM audio
        // This is required for Eleven Labs (Bengali) and works better for Deepgram (English)
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            sampleRate: 16000, // 16kHz sample rate for Eleven Labs
            channelCount: 1, // Mono
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }
        });
        
        mediaStreamRef.current = stream;

        // Create AudioContext with matching sample rate
        const audioContext = new AudioContext({ sampleRate: 16000 });
        audioContextRef.current = audioContext;

        const source = audioContext.createMediaStreamSource(stream);
        
        // Create ScriptProcessorNode to process audio chunks
        // Buffer size: 4096 samples (about 256ms at 16kHz)
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        audioProcessorRef.current = processor;

        processor.onaudioprocess = (event) => {
          if (!wsRef.current || ws.readyState !== WebSocket.OPEN) {
            return;
          }

          try {
            // Get audio data from input buffer (Float32Array, values -1.0 to 1.0)
            const inputData = event.inputBuffer.getChannelData(0);
            
            // Convert Float32 to Int16 PCM format
            const pcmData = convertFloat32ToInt16(inputData);
            
            // Send PCM audio chunk to server
            wsRef.current.sendAudioChunk(pcmData);
            
            // Log occasionally (every 10th chunk) to avoid spam
            if (Math.random() < 0.1) {
              console.log(`[RECORDING] Sent PCM audio chunk, size: ${pcmData.byteLength} bytes`);
            }
          } catch (error) {
            console.error(`[RECORDING] Error processing audio chunk:`, error);
          }
        };

        // Connect audio nodes
        source.connect(processor);
        processor.connect(audioContext.destination); // Required for ScriptProcessorNode to work

        setIsRecording(true);
        setRecordingTime(0);
        console.log(`[RECORDING] Recording started successfully in cloud mode with Web Audio API (PCM), WebSocket connected: ${wsConnected}`);
    } catch (err: any) {
      console.error(`[RECORDING] Failed to start recording:`, err);
      setError('Failed to access microphone: ' + err.message);
      recordingStartTimeRef.current = null;
      setTranscribing(false);
      setWsConnected(false);
    }
  };

  const stopRecording = async () => {
    const duration = recordingStartTimeRef.current ? Date.now() - recordingStartTimeRef.current : 0;
    console.log(`[RECORDING] Stopping recording, duration: ${duration}ms`);

    // Stop Web Audio API processing (cloud mode)
    if (audioProcessorRef.current) {
      audioProcessorRef.current.disconnect();
      audioProcessorRef.current = null;
      console.log(`[RECORDING] Disconnected audio processor`);
    }
    
    if (audioContextRef.current) {
      await audioContextRef.current.close().catch(console.error);
      audioContextRef.current = null;
      console.log(`[RECORDING] Closed audio context`);
    }
    
    // Stop media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        track.stop();
        console.log(`[RECORDING] Stopped stream track: ${track.kind}`);
      });
      mediaStreamRef.current = null;
    }
    
    // For batch mode (Bengali, Thai, Malay, Auto), keep WebSocket open to receive transcription updates
    const isBatchMode = consultation?.language && ['bn', 'th', 'ms', 'auto'].includes(consultation.language);
    
    if (wsRef.current) {
      if (isBatchMode) {
        // For batch mode, keep WebSocket open to receive transcription progress updates
        console.log(`[RECORDING] Keeping WebSocket open for batch transcription updates`);
        // Don't close the connection - let it stay open to receive updates
      } else {
        // For realtime mode, close WebSocket immediately
        wsRef.current.closeConnection();
        wsRef.current = null;
        console.log(`[RECORDING] WebSocket connection closed`);
      }
    }
    setIsRecording(false);
    // Keep wsConnected true for batch mode so we can receive updates
    if (!isBatchMode) {
      setWsConnected(false);
    }
    recordingStartTimeRef.current = null;
    
    // For realtime mode, reload consultation to get the final transcript
    // For batch mode, we'll get updates via WebSocket, so don't reload immediately
    if (!isBatchMode) {
      setTimeout(() => {
        loadConsultation();
      }, 500);
    }
    console.log(`[RECORDING] Recording stopped successfully`);
  };

  const handleGenerateNote = async () => {
    if (!id) return;
    setGeneratingNote(true);
    setError('');

    try {
      // Ensure we have a transcript before generating notes
      if (!transcript.trim()) {
        setError('Transcript is empty. Please record audio first.');
        setGeneratingNote(false);
        return;
      }

      // Reload to get latest transcript
      await loadConsultation();

      // Generate notes
      const response = await consultationsApi.generateNote(id);
      setConsultation(response.consultation);
      setNoteGenerated(true);
      navigate(`/consultations/${id}/detail`);
    } catch (err: any) {
      setError(err.message || 'Failed to generate note');
    } finally {
      setGeneratingNote(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="static" elevation={0}>
        <Toolbar>
          <IconButton edge="start" color="inherit" onClick={() => navigate('/dashboard')} sx={{ mr: 2 }}>
            <ArrowBack />
          </IconButton>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Consultation
          </Typography>
          {consultation && (
            <Chip
              label={consultation.status}
              color={consultation.status === 'completed' ? 'success' : 'default'}
              size="small"
            />
          )}
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: 4 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        {wsError && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {wsError}
          </Alert>
        )}

        {!wsConnected && isRecording && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Connecting to server...
          </Alert>
        )}

        {/* Patient Information */}
        {consultation?.patient && (
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <Person color="primary" />
                <Typography variant="h6">Patient Information</Typography>
              </Box>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={4}>
                  <Typography variant="body2" color="text.secondary">Name</Typography>
                  <Typography variant="body1">{consultation.patient.name}</Typography>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Typography variant="body2" color="text.secondary">Date of Birth</Typography>
                  <Typography variant="body1">
                    {new Date(consultation.patient.dateOfBirth).toLocaleDateString()}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Typography variant="body2" color="text.secondary">MRN</Typography>
                  <Typography variant="body1">{consultation.patient.mrn}</Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        )}


        {/* Consultation Language Display */}
        {consultation && (
          <Card sx={{ mb: 3, bgcolor: 'primary.light', color: 'primary.contrastText' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Info sx={{ fontSize: 20 }} />
                <Typography variant="body1" fontWeight="bold">
                  Consultation Language: {getLanguageDisplayName(consultation.language)}
                </Typography>
              </Box>
              {consultation.language === 'auto' && (
                <Typography variant="body2" sx={{ mb: 2, opacity: 0.9 }}>
                  The system will automatically detect the language during transcription.
                </Typography>
              )}
              {consultation.language === 'bn' && (
                <Typography variant="body2" sx={{ mb: 2, opacity: 0.9 }}>
                  Mixed Bengali and English content will be accurately transcribed.
                </Typography>
              )}
              {(consultation.language === 'bn' || consultation.language === 'auto') && (
                <FormControlLabel
                  control={
                    <Switch
                      checked={enableLanguageDetection}
                      onChange={(e) => setEnableLanguageDetection(e.target.checked)}
                      disabled={isRecording}
                      color="secondary"
                    />
                  }
                  label={
                    <Typography variant="body2" sx={{ opacity: 0.9 }}>
                      Enable automatic language detection
                    </Typography>
                  }
                  sx={{ mt: 1 }}
                />
              )}
              {detectedLanguage && enableLanguageDetection && (
                <Typography variant="body2" sx={{ mt: 1, opacity: 0.9, fontStyle: 'italic' }}>
                  Detected language: {getLanguageDisplayName(detectedLanguage)}
                </Typography>
              )}
            </CardContent>
          </Card>
        )}

        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3, flexWrap: 'wrap' }}>
              {!isRecording ? (
                <>
                  <Button
                    variant="contained"
                    startIcon={<Mic />}
                    onClick={startRecording}
                    disabled={noteGenerated}
                    size="large"
                  >
                    Start Recording
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="contained"
                    color="error"
                    startIcon={<Stop />}
                    onClick={stopRecording}
                    size="large"
                  >
                    Stop Recording
                  </Button>
                  <Typography variant="h6" sx={{ ml: 2 }}>
                    {formatTime(recordingTime)}
                  </Typography>
                </>
              )}
            </Box>

            <TextField
              fullWidth
              multiline
              rows={10}
              label="Live Transcript"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Transcript will appear here as you record..."
              sx={{ mb: 2 }}
              disabled={false}
            />
          </CardContent>
        </Card>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
          <Button
            variant="outlined"
            onClick={() => navigate('/dashboard')}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            startIcon={noteGenerated ? <CheckCircle /> : undefined}
            onClick={handleGenerateNote}
            disabled={generatingNote || noteGenerated || !transcript.trim()}
          >
            {transcribing ? (
              <>
                <CircularProgress size={16} sx={{ mr: 1 }} />
                Transcribing...
              </>
            ) : generatingNote ? (
              <>
                <CircularProgress size={16} sx={{ mr: 1 }} />
                Generating...
              </>
            ) : noteGenerated ? (
              'Note Generated'
            ) : (
              'Finish & Generate Note'
            )}
          </Button>
        </Box>
      </Container>

      {/* Recording Limit Dialog */}
      <Dialog
        open={showRecordingLimitDialog}
        onClose={() => setShowRecordingLimitDialog(false)}
        aria-labelledby="recording-limit-dialog-title"
        aria-describedby="recording-limit-dialog-description"
      >
        <DialogTitle id="recording-limit-dialog-title">
          Recording Time Limit Reached
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="recording-limit-dialog-description">
            The recording has reached the maximum duration of 1 hour. The recording has been automatically stopped.
            You can start a new recording for this same consultation to continue.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowRecordingLimitDialog(false)}>
            Close
          </Button>
          <Button
            onClick={() => {
              setShowRecordingLimitDialog(false);
              startRecording();
            }}
            variant="contained"
            startIcon={<Mic />}
            disabled={noteGenerated}
          >
            Start New Recording
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

