import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import { AuthRequest } from '../middleware/auth';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config/jwt';

const createToken = (userId: string) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
};

export const signup = async (req: Request, res: Response) => {
  try {
    const { email, password, name, specialization, clinicName, country } = req.body;

    if (!email || !password || !name || !specialization || !clinicName || !country) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const user = new User({
      email,
      password,
      name,
      specialization,
      clinicName,
      country,
    });

    await user.save();

    const token = createToken(user._id.toString());

    res.status(201).json({
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        specialization: user.specialization,
        clinicName: user.clinicName,
        country: user.country,
        role: user.role,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = createToken(user._id.toString());

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        specialization: user.specialization,
        clinicName: user.clinicName,
        country: user.country,
        role: user.role,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const logout = async (req: Request, res: Response) => {
  res.json({ message: 'Logged out successfully' });
};

export const getMe = async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        specialization: user.specialization,
        clinicName: user.clinicName,
        country: user.country,
        role: user.role,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

