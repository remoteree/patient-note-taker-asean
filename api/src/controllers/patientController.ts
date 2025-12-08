import { Response } from 'express';
import Patient from '../models/Patient';
import { AuthRequest } from '../middleware/auth';

export const searchPatients = async (req: AuthRequest, res: Response) => {
  try {
    const { query } = req.query;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const searchQuery = query.trim();

    // Search by name, MRN, or date of birth
    // For DOB, we'll try to parse common date formats
    const dobRegex = /^\d{4}-\d{2}-\d{2}$|^\d{2}\/\d{2}\/\d{4}$|^\d{2}-\d{2}-\d{4}$/;
    let dobQuery: Date | null = null;

    if (dobRegex.test(searchQuery)) {
      try {
        dobQuery = new Date(searchQuery);
        if (isNaN(dobQuery.getTime())) {
          dobQuery = null;
        }
      } catch {
        dobQuery = null;
      }
    }

    // Build search conditions
    const conditions: any = {
      userId: req.userId,
      $or: [
        { name: { $regex: searchQuery, $options: 'i' } },
        { mrn: { $regex: searchQuery, $options: 'i' } },
      ],
    };

    if (dobQuery) {
      // Search for dates within the same day (ignoring time)
      const startOfDay = new Date(dobQuery);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(dobQuery);
      endOfDay.setHours(23, 59, 59, 999);
      conditions.$or.push({
        dateOfBirth: {
          $gte: startOfDay,
          $lte: endOfDay,
        },
      });
    }

    const patients = await Patient.find(conditions)
      .sort({ name: 1 })
      .limit(20)
      .select('-__v');

    res.json({
      patients: patients.map(p => ({
        id: p._id,
        name: p.name,
        dateOfBirth: p.dateOfBirth,
        mrn: p.mrn,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getPatient = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const patient = await Patient.findOne({
      _id: id,
      userId: req.userId,
    });

    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    res.json({
      patient: {
        id: patient._id,
        name: patient.name,
        dateOfBirth: patient.dateOfBirth,
        mrn: patient.mrn,
        createdAt: patient.createdAt,
        updatedAt: patient.updatedAt,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const createPatient = async (req: AuthRequest, res: Response) => {
  try {
    const { name, dateOfBirth, mrn } = req.body;

    if (!name || !dateOfBirth || !mrn) {
      return res.status(400).json({ error: 'Name, date of birth, and MRN are required' });
    }

    // Check if MRN already exists for this doctor
    const existingPatient = await Patient.findOne({
      userId: req.userId,
      mrn: mrn.trim(),
    });

    if (existingPatient) {
      return res.status(400).json({ error: 'A patient with this MRN already exists' });
    }

    const patient = new Patient({
      userId: req.userId,
      name: name.trim(),
      dateOfBirth: new Date(dateOfBirth),
      mrn: mrn.trim(),
    });

    await patient.save();

    res.status(201).json({
      patient: {
        id: patient._id,
        name: patient.name,
        dateOfBirth: patient.dateOfBirth,
        mrn: patient.mrn,
        createdAt: patient.createdAt,
        updatedAt: patient.updatedAt,
      },
    });
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(400).json({ error: 'A patient with this MRN already exists' });
    }
    res.status(500).json({ error: error.message });
  }
};

