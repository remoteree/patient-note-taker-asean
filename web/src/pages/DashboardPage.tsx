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
  TextField,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
} from '@mui/material';
import { Logout, Add, AdminPanelSettings } from '@mui/icons-material';
import { useAuth } from '../hooks/useAuth';
import { consultationsApi } from '../api/consultations';
import { patientsApi } from '../api/patients';
import { Consultation, Patient, ConsultationLanguage } from '../types';
import PatientSearchDialog from '../components/PatientSearchDialog';

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [allPatients, setAllPatients] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [patientSearchOpen, setPatientSearchOpen] = useState(false);

  useEffect(() => {
    loadConsultations();
    loadAllPatients();
  }, []);

  useEffect(() => {
    loadConsultations();
  }, [selectedPatientId]);

  const loadAllPatients = async () => {
    try {
      // Load all patients by searching with empty query (we'll need to update backend or use a different approach)
      // For now, we'll load patients from consultations
      const response = await consultationsApi.getConsultations();
      const patientMap = new Map<string, Patient>();
      response.consultations.forEach((c) => {
        if (c.patient && !patientMap.has(c.patient.id)) {
          patientMap.set(c.patient.id, c.patient);
        }
      });
      setAllPatients(Array.from(patientMap.values()));
    } catch (err) {
      // Ignore errors for patient loading
    }
  };

  const loadConsultations = async () => {
    try {
      const response = await consultationsApi.getConsultations(selectedPatientId || undefined);
      setConsultations(response.consultations);
      
      // Update patient list from consultations
      const patientMap = new Map<string, Patient>();
      response.consultations.forEach((c) => {
        if (c.patient && !patientMap.has(c.patient.id)) {
          patientMap.set(c.patient.id, c.patient);
        }
      });
      setAllPatients(Array.from(patientMap.values()));
    } catch (err: any) {
      setError(err.message || 'Failed to load consultations');
    } finally {
      setLoading(false);
    }
  };

  const handleNewConsultation = () => {
    setPatientSearchOpen(true);
  };

  const handleSelectPatient = async (patient: Patient, language: ConsultationLanguage = 'bn') => {
    try {
      const response = await consultationsApi.createConsultation(patient.id, language);
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
    if (consultation.doctorSummary) {
      return consultation.doctorSummary.substring(0, 100) + '...';
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
          {user?.role === 'admin' && (
            <Button
              color="inherit"
              startIcon={<AdminPanelSettings />}
              onClick={() => navigate('/admin')}
              sx={{ mr: 1 }}
            >
              Admin
            </Button>
          )}
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

        <Box sx={{ mb: 3, display: 'flex', gap: 2, alignItems: 'center' }}>
          <FormControl sx={{ minWidth: 200 }}>
            <InputLabel>Filter by Patient</InputLabel>
            <Select
              value={selectedPatientId}
              label="Filter by Patient"
              onChange={(e) => setSelectedPatientId(e.target.value)}
            >
              <MenuItem value="">All Patients</MenuItem>
              {allPatients.map((patient) => (
                <MenuItem key={patient.id} value={patient.id}>
                  {patient.name} ({patient.mrn})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
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
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                          <Typography variant="h6">
                            {formatDate(consultation.createdAt)}
                          </Typography>
                          {consultation.patient && (
                            <Typography variant="body2" color="text.secondary">
                              Patient: {consultation.patient.name}
                            </Typography>
                          )}
                          <Chip
                            label={consultation.status}
                            color={getStatusColor(consultation.status) as any}
                            size="small"
                          />
                          {consultation.tags && consultation.tags.length > 0 && (
                            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                              {consultation.tags.slice(0, 3).map((tag, idx) => (
                                <Chip key={idx} label={tag} size="small" variant="outlined" />
                              ))}
                            </Box>
                          )}
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

      <PatientSearchDialog
        open={patientSearchOpen}
        onClose={() => setPatientSearchOpen(false)}
        onSelectPatient={(patient, mode, language) => handleSelectPatient(patient, mode, language)}
      />
    </Box>
  );
}



