import { Router } from 'express';
import {
  searchPatients,
  getPatient,
  createPatient,
} from '../controllers/patientController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/search', searchPatients);
router.get('/:id', getPatient);
router.post('/', createPatient);

export default router;

