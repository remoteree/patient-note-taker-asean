import { Router } from 'express';
import {
  createConsultation,
  getConsultations,
  getConsultation,
  generateNote,
} from '../controllers/consultationController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.post('/', createConsultation);
router.get('/', getConsultations);
router.get('/:id', getConsultation);
router.post('/:id/generate-note', generateNote);

export default router;



