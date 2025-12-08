import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemText,
  Chip,
  AppBar,
  Toolbar,
  IconButton,
  CircularProgress,
  Alert,
} from '@mui/material';
import { Logout, Add } from '@mui/icons-material';
import { useAuth } from '../hooks/useAuth';
import { consultationsApi } from '../api/consultations';
import { Consultation } from '../types';

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadConsultations();
  }, []);

  const loadConsultations = async () => {
    try {
      const response = await consultationsApi.getConsultations();
      setConsultations(response.consultations);
    } catch (err: any) {
      setError(err.message || 'Failed to load consultations');
    } finally {
      setLoading(false);
    }
  };

  const handleNewConsultation = async () => {
    try {
      const response = await consultationsApi.createConsultation();
      navigate(`/consultations/${response.consultation.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to create consultation');
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
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

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const getPreview = (consultation: Consultation) => {
    if (consultation.note) {
      return consultation.note.substring(0, 100) + '...';
    }
    if (consultation.transcript) {
      return consultation.transcript.substring(0, 100) + '...';
    }
    return 'No content yet';
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="static" elevation={0}>
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Doc AI
          </Typography>
          <Typography variant="body2" sx={{ mr: 2 }}>
            {user?.name}
          </Typography>
          <IconButton color="inherit" onClick={handleLogout}>
            <Logout />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Typography variant="h4" component="h1">
            Consultations
          </Typography>
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={handleNewConsultation}
          >
            New Consultation
          </Button>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : consultations.length === 0 ? (
          <Card>
            <CardContent>
              <Typography variant="body1" color="text.secondary" align="center" sx={{ py: 4 }}>
                No consultations yet. Start a new consultation to begin.
              </Typography>
            </CardContent>
          </Card>
        ) : (
          <List>
            {consultations.map((consultation) => (
              <Card key={consultation.id} sx={{ mb: 2 }}>
                <CardContent>
                  <ListItem
                    button
                    onClick={() => navigate(`/consultations/${consultation.id}/detail`)}
                  >
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="h6">
                            {formatDate(consultation.createdAt)}
                          </Typography>
                          <Chip
                            label={consultation.status}
                            color={getStatusColor(consultation.status) as any}
                            size="small"
                          />
                        </Box>
                      }
                      secondary={getPreview(consultation)}
                    />
                  </ListItem>
                </CardContent>
              </Card>
            ))}
          </List>
        )}
      </Container>
    </Box>
  );
}



