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
} from '@mui/material';
import { Search, Add, Close } from '@mui/icons-material';
import { patientsApi } from '../api/patients';
import { Patient } from '../types';

interface PatientSearchDialogProps {
  open: boolean;
  onClose: () => void;
  onSelectPatient: (patient: Patient) => void;
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
      onSelectPatient(response.patient);
      handleClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create patient');
    } finally {
      setCreating(false);
    }
  };

  const handleClose = () => {
    setSearchQuery('');
    setPatients([]);
    setError('');
    setShowCreateForm(false);
    setNewPatient({ name: '', dateOfBirth: '', mrn: '' });
    onClose();
  };

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
                    <ListItemButton onClick={() => onSelectPatient(patient)}>
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

