import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemButton,
  CircularProgress,
  Alert,
  Box,
  Typography,
  Divider,
  IconButton,
  FormControl,
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
  Paper,
  Select,
  MenuItem,
  InputLabel,
} from '@mui/material';
import { Search, Add, Close } from '@mui/icons-material';
import { patientsApi } from '../api/patients';
import { Patient, ConsultationLanguage } from '../types';

interface PatientSearchDialogProps {
  open: boolean;
  onClose: () => void;
  onSelectPatient: (patient: Patient, language: ConsultationLanguage) => void;
}

export default function PatientSearchDialog({ open, onClose, onSelectPatient }: PatientSearchDialogProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newPatient, setNewPatient] = useState({
    name: '',
    dateOfBirth: '',
    mrn: '',
  });
  const [creating, setCreating] = useState(false);
  const [languageMode, setLanguageMode] = useState<'select' | 'auto'>('select');
  const [selectedLanguage, setSelectedLanguage] = useState<'bn' | 'th' | 'ms'>('bn');
  const [language, setLanguage] = useState<ConsultationLanguage>('bn');

  useEffect(() => {
    if (open && searchQuery.trim().length >= 2) {
      const timeoutId = setTimeout(() => {
        searchPatients();
      }, 300);
      return () => clearTimeout(timeoutId);
    } else if (open && searchQuery.trim().length === 0) {
      setPatients([]);
    }
  }, [searchQuery, open]);

  const searchPatients = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setError('');
    try {
      const response = await patientsApi.searchPatients(searchQuery);
      setPatients(response.patients);
    } catch (err: any) {
      setError(err.message || 'Failed to search patients');
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePatient = async () => {
    if (!newPatient.name || !newPatient.dateOfBirth || !newPatient.mrn) {
      setError('All fields are required');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const response = await patientsApi.createPatient(newPatient);
      onSelectPatient(response.patient, language);
      handleClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create patient');
    } finally {
      setCreating(false);
    }
  };

  const handleSelectExistingPatient = (patient: Patient) => {
    onSelectPatient(patient, language);
    handleClose();
  };

  const handleClose = () => {
    setSearchQuery('');
    setPatients([]);
    setError('');
    setShowCreateForm(false);
    setNewPatient({ name: '', dateOfBirth: '', mrn: '' });
    setLanguageMode('select');
    setSelectedLanguage('bn');
    setLanguage('bn');
    onClose();
  };

  // Update language when mode or selected language changes
  useEffect(() => {
    if (languageMode === 'auto') {
      setLanguage('auto');
    } else {
      setLanguage(selectedLanguage);
    }
  }, [languageMode, selectedLanguage]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {showCreateForm ? 'Add New Patient' : 'Select Patient'}
          <IconButton onClick={handleClose} size="small">
            <Close />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent>
        {!showCreateForm ? (
          <>
            <FormControl component="fieldset" sx={{ mb: 2, width: '100%' }}>
              <FormLabel component="legend">Consultation Language *</FormLabel>
              <RadioGroup
                row
                value={languageMode}
                onChange={(e) => setLanguageMode(e.target.value as 'select' | 'auto')}
              >
                <FormControlLabel value="select" control={<Radio />} label="Select Language" />
                <FormControlLabel value="auto" control={<Radio />} label="Auto-detect" />
              </RadioGroup>
              {languageMode === 'select' && (
                <FormControl fullWidth sx={{ mt: 2 }}>
                  <InputLabel id="language-select-label">Language</InputLabel>
                  <Select
                    labelId="language-select-label"
                    value={selectedLanguage}
                    label="Language"
                    onChange={(e) => setSelectedLanguage(e.target.value as 'bn' | 'th' | 'ms')}
                  >
                    <MenuItem value="bn">Bangla (বাংলা)</MenuItem>
                    <MenuItem value="th">Thai (ไทย)</MenuItem>
                    <MenuItem value="ms">Malay (Bahasa Melayu)</MenuItem>
                  </Select>
                </FormControl>
              )}
              {languageMode === 'auto' && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  The system will automatically detect the language during transcription.
                </Typography>
              )}
            </FormControl>

            <TextField
              fullWidth
              label="Search by name, DOB (YYYY-MM-DD), or MRN"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Type at least 2 characters to search..."
              sx={{ mb: 2 }}
              InputProps={{
                startAdornment: <Search sx={{ mr: 1, color: 'text.secondary' }} />,
              }}
            />

            {error && (
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
                {error}
              </Alert>
            )}

            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress />
              </Box>
            ) : patients.length > 0 ? (
              <List>
                {patients.map((patient) => (
                  <ListItem key={patient.id} disablePadding>
                    <ListItemButton onClick={() => handleSelectExistingPatient(patient)}>
                      <ListItemText
                        primary={patient.name}
                        secondary={
                          <>
                            DOB: {formatDate(patient.dateOfBirth)} | MRN: {patient.mrn}
                          </>
                        }
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            ) : searchQuery.trim().length >= 2 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                No patients found. Try a different search or create a new patient.
              </Typography>
            ) : null}

            <Divider sx={{ my: 2 }} />

            <Button
              fullWidth
              variant="outlined"
              startIcon={<Add />}
              onClick={() => setShowCreateForm(true)}
            >
              Add New Patient
            </Button>
          </>
        ) : (
          <>
            <TextField
              fullWidth
              label="Patient Name"
              value={newPatient.name}
              onChange={(e) => setNewPatient({ ...newPatient, name: e.target.value })}
              sx={{ mb: 2 }}
              required
            />
            <TextField
              fullWidth
              label="Date of Birth"
              type="date"
              value={newPatient.dateOfBirth}
              onChange={(e) => setNewPatient({ ...newPatient, dateOfBirth: e.target.value })}
              InputLabelProps={{ shrink: true }}
              sx={{ mb: 2 }}
              required
            />
            <TextField
              fullWidth
              label="Medical Record Number (MRN)"
              value={newPatient.mrn}
              onChange={(e) => setNewPatient({ ...newPatient, mrn: e.target.value })}
              sx={{ mb: 2 }}
              required
            />
            {error && (
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
                {error}
              </Alert>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        {showCreateForm ? (
          <>
            <Button onClick={() => setShowCreateForm(false)}>Cancel</Button>
            <Button
              variant="contained"
              onClick={handleCreatePatient}
              disabled={creating || !newPatient.name || !newPatient.dateOfBirth || !newPatient.mrn}
            >
              {creating ? <CircularProgress size={20} /> : 'Create Patient'}
            </Button>
          </>
        ) : (
          <Button onClick={handleClose}>Cancel</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

