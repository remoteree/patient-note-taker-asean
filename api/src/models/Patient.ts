import mongoose, { Document, Schema } from 'mongoose';

export interface IPatient extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  dateOfBirth: Date;
  mrn: string; // Medical Record Number
  createdAt: Date;
  updatedAt: Date;
}

const PatientSchema = new Schema<IPatient>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  dateOfBirth: {
    type: Date,
    required: true,
  },
  mrn: {
    type: String,
    required: true,
    trim: true,
  },
}, {
  timestamps: true,
});

// Compound index for userId + mrn to ensure unique MRN per doctor
PatientSchema.index({ userId: 1, mrn: 1 }, { unique: true });

// Index for searching
PatientSchema.index({ userId: 1, name: 'text', mrn: 'text' });

export default mongoose.model<IPatient>('Patient', PatientSchema);

