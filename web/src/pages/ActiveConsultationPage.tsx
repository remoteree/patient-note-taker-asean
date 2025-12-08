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
} from '@mui/material';
import { ArrowBack, Mic, Stop, CheckCircle } from '@mui/icons-material';
import { useAuth } from '../hooks/useAuth';
import { consultationsApi } from '../api/consultations';
import { Consultation } from '../types';

export default function ActiveConsultationPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [consultation, setConsultation] = useState<Consultation | null>(null);
  const [transcript, setTranscript] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [loading, setLoading] = useState(true);
  const [generatingNote, setGeneratingNote] = useState(false);
  const [error, setError] = useState('');
  const [noteGenerated, setNoteGenerated] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const wsRef = useRef<{ sendAudioChunk: (chunk: ArrayBuffer) => void; closeConnection: () => void } | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);

  useEffect(() => {
    loadConsultation();
  }, [id]);

  useEffect(() => {
    if (isRecording) {
      intervalRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
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
      setTranscript(response.consultation.transcript || '');
      setNoteGenerated(!!response.consultation.note);
    } catch (err: any) {
      setError(err.message || 'Failed to load consultation');
    } finally {
      setLoading(false);
    }
  };

  const handleTranscriptUpdate = (newTranscript: string) => {
    setTranscript(newTranscript);
  };

  const startRecording = async () => {
    if (!id) return;

    try {
      // Get token from cookies
      const cookies = document.cookie.split(';');
      const tokenCookie = cookies.find(c => c.trim().startsWith('token='));
      const token = tokenCookie ? tokenCookie.split('=')[1] : null;

      if (!token) {
        setError('Authentication required');
        return;
      }

      // Connect WebSocket (use WSS for HTTPS, WS for HTTP)
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/consultations?consultationId=${id}&token=${token}`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setWsConnected(true);
        setWsError(null);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'TRANSCRIPT_UPDATE' && message.transcript) {
            handleTranscriptUpdate(message.transcript);
          }
        } catch (err) {
          console.error('Error parsing WebSocket message:', err);
        }
      };

      ws.onerror = () => {
        setWsError('WebSocket connection error');
      };

      ws.onclose = () => {
        setWsConnected(false);
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

      // Start audio recording
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm',
      });

      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && wsRef.current) {
          event.data.arrayBuffer().then((buffer) => {
            wsRef.current!.sendAudioChunk(buffer);
          });
        }
      };

      // Send chunks every 500ms
      mediaRecorder.start(500);
      setIsRecording(true);
      setRecordingTime(0);
    } catch (err: any) {
      setError('Failed to access microphone: ' + err.message);
    }
  };

  const stopRecording = async () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
      mediaRecorderRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.closeConnection();
      wsRef.current = null;
    }
    setIsRecording(false);
    setWsConnected(false);
    
    // Reload consultation to get the final transcript
    setTimeout(() => {
      loadConsultation();
    }, 500);
  };

  const handleGenerateNote = async () => {
    if (!id) return;
    setGeneratingNote(true);
    setError('');

    try {
      // First, update the consultation with the current transcript
      await loadConsultation();

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

        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
              {!isRecording ? (
                <Button
                  variant="contained"
                  startIcon={<Mic />}
                  onClick={startRecording}
                  disabled={noteGenerated}
                  size="large"
                >
                  Start Recording
                </Button>
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
            disabled={generatingNote || !transcript.trim() || noteGenerated}
          >
            {generatingNote ? (
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
    </Box>
  );
}

