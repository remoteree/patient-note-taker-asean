import { Router } from 'express';
import {
  getTranscriptionConfigs,
  getTranscriptionConfig,
  updateTranscriptionConfig,
  resetTranscriptionConfigs,
} from '../controllers/adminController';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

const router = Router();

// All admin routes require authentication and admin role
router.use(authenticate);
router.use(requireAdmin);

router.get('/transcription-configs', getTranscriptionConfigs);
router.get('/transcription-configs/:language', getTranscriptionConfig);
router.put('/transcription-configs/:language', updateTranscriptionConfig);
router.post('/transcription-configs/reset', resetTranscriptionConfigs);

export default router;

