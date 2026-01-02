import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Switch,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip,
} from '@mui/material';
import { Logout, Settings, Refresh } from '@mui/icons-material';
import { useAuth } from '../hooks/useAuth';
import { adminApi, TranscriptionConfig, CloudProvider } from '../api/admin';

const LANGUAGE_LABELS: Record<string, string> = {
  bn: 'Bengali',
  en: 'English',
  th: 'Thai',
  ms: 'Malay',
  auto: 'Auto-detect',
};

export default function AdminDashboardPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [configs, setConfigs] = useState<TranscriptionConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editingConfig, setEditingConfig] = useState<TranscriptionConfig | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await adminApi.getTranscriptionConfigs();
      setConfigs(response.configs);
    } catch (err: any) {
      setError(err.message || 'Failed to load transcription configurations');
    } finally {
      setLoading(false);
    }
  };


  const handleEdit = (config: TranscriptionConfig) => {
    setEditingConfig(config);
    setEditDialogOpen(true);
  };

  const handleSave = async (updatedData: {
    cloudProvider?: CloudProvider;
    enabled?: boolean;
    config?: Record<string, any>;
  }) => {
    if (!editingConfig) return;

    try {
      setError('');
      setSuccess('');
      const response = await adminApi.updateTranscriptionConfig(editingConfig.language, updatedData);
      setConfigs(configs.map(c => c.language === editingConfig.language ? response.config : c));
      setEditDialogOpen(false);
      setEditingConfig(null);
      setSuccess('Configuration updated successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to update configuration');
    }
  };

  const handleReset = async () => {
    try {
      setError('');
      setSuccess('');
      const response = await adminApi.resetTranscriptionConfigs();
      setConfigs(response.configs);
      setResetDialogOpen(false);
      setSuccess('Configurations reset to defaults');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to reset configurations');
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const toggleEnabled = async (config: TranscriptionConfig) => {
    await handleSave({ enabled: !config.enabled });
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="static" elevation={0}>
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Doc AI - Admin Dashboard
          </Typography>
          <Button
            color="inherit"
            onClick={() => navigate('/dashboard')}
            sx={{ mr: 2 }}
          >
            Back to Dashboard
          </Button>
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
            Transcription Configuration
          </Typography>
          <Button
            variant="outlined"
            startIcon={<Refresh />}
            onClick={() => setResetDialogOpen(true)}
            color="warning"
          >
            Reset to Defaults
          </Button>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        {success && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>
            {success}
          </Alert>
        )}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Language</TableCell>
                  <TableCell>Cloud Provider</TableCell>
                  <TableCell>Enabled</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {configs.map((config) => (
                  <TableRow key={config.language}>
                    <TableCell>
                      <Typography variant="body1" fontWeight="medium">
                        {LANGUAGE_LABELS[config.language] || config.language}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        ({config.language})
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={config.cloudProvider} size="small" />
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={config.enabled}
                        onChange={() => toggleEnabled(config)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        startIcon={<Settings />}
                        onClick={() => handleEdit(config)}
                      >
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Container>

      {/* Edit Dialog */}
      <EditConfigDialog
        open={editDialogOpen}
        config={editingConfig}
        onClose={() => {
          setEditDialogOpen(false);
          setEditingConfig(null);
        }}
        onSave={handleSave}
      />

      {/* Reset Confirmation Dialog */}
      <Dialog open={resetDialogOpen} onClose={() => setResetDialogOpen(false)}>
        <DialogTitle>Reset Configurations</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to reset all transcription configurations to their default values?
            This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleReset} color="warning" variant="contained">
            Reset
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

interface EditConfigDialogProps {
  open: boolean;
  config: TranscriptionConfig | null;
  onClose: () => void;
  onSave: (data: {
    cloudProvider?: CloudProvider;
    enabled?: boolean;
    config?: Record<string, any>;
  }) => void;
}

function EditConfigDialog({ open, config, onClose, onSave }: EditConfigDialogProps) {
  const [cloudProvider, setCloudProvider] = useState<CloudProvider>('elevenlabs');
  const [enabled, setEnabled] = useState(true);
  const [configJson, setConfigJson] = useState('{}');

  useEffect(() => {
    if (config) {
      setCloudProvider(config.cloudProvider);
      setEnabled(config.enabled);
      setConfigJson(JSON.stringify(config.config || {}, null, 2));
    }
  }, [config]);

  const handleSave = () => {
    try {
      const parsedConfig = JSON.parse(configJson);
      onSave({
        cloudProvider,
        enabled,
        config: parsedConfig,
      });
    } catch (err) {
      alert('Invalid JSON in config field');
    }
  };

  if (!config) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Edit Configuration - {LANGUAGE_LABELS[config.language] || config.language}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <FormControl fullWidth>
            <InputLabel>Cloud Provider</InputLabel>
            <Select
              value={cloudProvider}
              label="Cloud Provider"
              onChange={(e) => setCloudProvider(e.target.value as CloudProvider)}
            >
              <MenuItem value="aws">AWS Transcribe (Batch Mode)</MenuItem>
              <MenuItem value="deepgram">Deepgram (Realtime Mode)</MenuItem>
              <MenuItem value="elevenlabs">ElevenLabs (Batch Mode)</MenuItem>
            </Select>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
              Deepgram supports real-time streaming. AWS Transcribe and ElevenLabs use batch processing.
            </Typography>
          </FormControl>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography>Enabled</Typography>
            <Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          </Box>

          <TextField
            fullWidth
            multiline
            rows={6}
            label="Provider-specific Config (JSON)"
            value={configJson}
            onChange={(e) => setConfigJson(e.target.value)}
            helperText="Enter JSON configuration for provider-specific settings"
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} variant="contained">
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

