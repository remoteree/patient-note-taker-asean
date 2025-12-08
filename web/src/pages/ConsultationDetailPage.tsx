import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Container,
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  AppBar,
  Toolbar,
  IconButton,
  CircularProgress,
  Alert,
  Chip,
  Divider,
  Grid,
  Paper,
} from '@mui/material';
import { ArrowBack, Person, LocalHospital } from '@mui/icons-material';
import { consultationsApi } from '../api/consultations';
import { Consultation } from '../types';

export default function ConsultationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [consultation, setConsultation] = useState<Consultation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadConsultation();
  }, [id]);

  const loadConsultation = async () => {
    if (!id) return;
    try {
      const response = await consultationsApi.getConsultation(id);
      setConsultation(response.consultation);
    } catch (err: any) {
      setError(err.message || 'Failed to load consultation');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const formatDOB = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const getStatusColor = (status: Consultation['status']) => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'processing':
        return 'info';
      case 'failed':
        return 'error';
      default:
        return 'default';
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!consultation) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error">Consultation not found</Alert>
      </Container>
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
            Consultation Details
          </Typography>
          <Chip
            label={consultation.status}
            color={getStatusColor(consultation.status) as any}
            size="small"
          />
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: 4 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Created: {formatDate(consultation.createdAt)}
        </Typography>

        {/* Patient Information */}
        {consultation.patient && (
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <Person color="primary" />
                <Typography variant="h6">Patient Information</Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />
              <Grid container spacing={2}>
                <Grid item xs={12} sm={4}>
                  <Typography variant="body2" color="text.secondary">Name</Typography>
                  <Typography variant="body1">{consultation.patient.name}</Typography>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Typography variant="body2" color="text.secondary">Date of Birth</Typography>
                  <Typography variant="body1">{formatDOB(consultation.patient.dateOfBirth)}</Typography>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Typography variant="body2" color="text.secondary">MRN</Typography>
                  <Typography variant="body1">{consultation.patient.mrn}</Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        )}

        {/* Tags */}
        {consultation.tags && consultation.tags.length > 0 && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Tags:
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {consultation.tags.map((tag, idx) => (
                <Chip key={idx} label={tag} size="small" variant="outlined" />
              ))}
            </Box>
          </Box>
        )}

        {/* Transcript */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Transcript
            </Typography>
            <Divider sx={{ mb: 2 }} />
            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
              {consultation.transcript || 'No transcript available'}
            </Typography>
          </CardContent>
        </Card>

        {/* Doctor Summary */}
        {consultation.doctorSummary && (
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <LocalHospital color="primary" />
                <Typography variant="h6">Clinical Summary (For Doctor)</Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />
              <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                {consultation.doctorSummary}
              </Typography>
            </CardContent>
          </Card>
        )}

        {/* Patient Note */}
        {consultation.patientNote && (
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <Person color="primary" />
                <Typography variant="h6">Patient Note</Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />
              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.default' }}>
                <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                  {consultation.patientNote}
                </Typography>
              </Paper>
            </CardContent>
          </Card>
        )}

        {consultation.status === 'failed' && (
          <Alert severity="error" sx={{ mt: 2 }}>
            Note generation failed. Please try again.
          </Alert>
        )}

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3 }}>
          <Button variant="outlined" onClick={() => navigate('/dashboard')}>
            Back to Dashboard
          </Button>
        </Box>
      </Container>
    </Box>
  );
}



