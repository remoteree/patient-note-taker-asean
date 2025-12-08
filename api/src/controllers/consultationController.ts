import { Response } from 'express';
import Consultation from '../models/Consultation';
import Patient from '../models/Patient';
import { AuthRequest } from '../middleware/auth';
import { noteService } from '../services/noteService';
import { transcriptionService } from '../services/transcriptionService';

export const createConsultation = async (req: AuthRequest, res: Response) => {
  try {
    const { patientId } = req.body;

    if (!patientId) {
      return res.status(400).json({ error: 'Patient ID is required' });
    }

    // Verify patient belongs to the doctor
    const patient = await Patient.findOne({
      _id: patientId,
      userId: req.userId,
    });

    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    const consultation = new Consultation({
      userId: req.userId,
      patientId: patientId,
      transcript: '',
      doctorSummary: null,
      patientNote: null,
      tags: [],
      status: 'in_progress',
    });

    await consultation.save();

    res.status(201).json({
      consultation: {
        id: consultation._id,
        userId: consultation.userId,
        patientId: consultation.patientId,
        transcript: consultation.transcript,
        doctorSummary: consultation.doctorSummary,
        patientNote: consultation.patientNote,
        tags: consultation.tags,
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
    const { patientId } = req.query;

    const query: any = { userId: req.userId };
    if (patientId) {
      query.patientId = patientId;
    }

    const consultations = await Consultation.find(query)
      .populate('patientId', 'name dateOfBirth mrn')
      .sort({ createdAt: -1 })
      .select('-__v');

    res.json({
      consultations: consultations.map(c => ({
        id: c._id,
        userId: c.userId,
        patientId: c.patientId,
        patient: c.patientId,
        transcript: c.transcript,
        doctorSummary: c.doctorSummary,
        patientNote: c.patientNote,
        tags: c.tags,
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
    }).populate('patientId', 'name dateOfBirth mrn');

    if (!consultation) {
      return res.status(404).json({ error: 'Consultation not found' });
    }

    res.json({
      consultation: {
        id: consultation._id,
        userId: consultation.userId,
        patientId: consultation.patientId,
        patient: consultation.patientId,
        transcript: consultation.transcript,
        doctorSummary: consultation.doctorSummary,
        patientNote: consultation.patientNote,
        tags: consultation.tags,
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
    }).populate('patientId', 'name dateOfBirth mrn');

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
      const { doctorSummary, patientNote, tags } = await noteService.generateNotes(consultation.transcript);
      
      consultation.doctorSummary = doctorSummary;
      consultation.patientNote = patientNote;
      consultation.tags = tags;
      consultation.status = 'completed';
      await consultation.save();

      res.json({
        consultation: {
          id: consultation._id,
          userId: consultation.userId,
          patientId: consultation.patientId,
          patient: consultation.patientId,
          transcript: consultation.transcript,
          doctorSummary: consultation.doctorSummary,
          patientNote: consultation.patientNote,
          tags: consultation.tags,
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



