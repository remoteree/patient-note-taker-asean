import { Response } from 'express';
import Consultation from '../models/Consultation';
import { AuthRequest } from '../middleware/auth';
import { noteService } from '../services/noteService';
import { transcriptionService } from '../services/transcriptionService';

export const createConsultation = async (req: AuthRequest, res: Response) => {
  try {
    const consultation = new Consultation({
      userId: req.userId,
      transcript: '',
      note: null,
      status: 'in_progress',
    });

    await consultation.save();

    res.status(201).json({
      consultation: {
        id: consultation._id,
        userId: consultation.userId,
        transcript: consultation.transcript,
        note: consultation.note,
        status: consultation.status,
        createdAt: consultation.createdAt,
        updatedAt: consultation.updatedAt,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getConsultations = async (req: AuthRequest, res: Response) => {
  try {
    const consultations = await Consultation.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .select('-__v');

    res.json({
      consultations: consultations.map(c => ({
        id: c._id,
        userId: c.userId,
        transcript: c.transcript,
        note: c.note,
        status: c.status,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getConsultation = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const consultation = await Consultation.findOne({
      _id: id,
      userId: req.userId,
    });

    if (!consultation) {
      return res.status(404).json({ error: 'Consultation not found' });
    }

    res.json({
      consultation: {
        id: consultation._id,
        userId: consultation.userId,
        transcript: consultation.transcript,
        note: consultation.note,
        status: consultation.status,
        createdAt: consultation.createdAt,
        updatedAt: consultation.updatedAt,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const generateNote = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const consultation = await Consultation.findOne({
      _id: id,
      userId: req.userId,
    });

    if (!consultation) {
      return res.status(404).json({ error: 'Consultation not found' });
    }

    if (consultation.status !== 'in_progress') {
      return res.status(400).json({ error: 'Consultation is not in progress' });
    }

    // Update status to processing
    consultation.status = 'processing';
    await consultation.save();

    try {
      const note = await noteService.generateNote(consultation.transcript);
      
      consultation.note = note;
      consultation.status = 'completed';
      await consultation.save();

      res.json({
        consultation: {
          id: consultation._id,
          userId: consultation.userId,
          transcript: consultation.transcript,
          note: consultation.note,
          status: consultation.status,
          createdAt: consultation.createdAt,
          updatedAt: consultation.updatedAt,
        },
      });
    } catch (error: any) {
      consultation.status = 'failed';
      await consultation.save();
      throw error;
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};



