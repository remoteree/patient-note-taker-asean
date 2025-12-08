import mongoose, { Document, Schema } from 'mongoose';
import { encryptionService } from '../services/encryptionService';

export type ConsultationStatus = 'in_progress' | 'processing' | 'completed' | 'failed';

export interface IConsultation extends Document {
  userId: mongoose.Types.ObjectId;
  patientId: mongoose.Types.ObjectId;
  transcript: string;
  doctorSummary: string | null;
  patientNote: string | null;
  tags: string[];
  status: ConsultationStatus;
  createdAt: Date;
  updatedAt: Date;
}

const ConsultationSchema = new Schema<IConsultation>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  patientId: {
    type: Schema.Types.ObjectId,
    ref: 'Patient',
    required: true,
  },
  transcript: {
    type: String,
    default: '',
  },
  doctorSummary: {
    type: String,
    default: null,
  },
  patientNote: {
    type: String,
    default: null,
  },
  tags: {
    type: [String],
    default: [],
  },
  status: {
    type: String,
    enum: ['in_progress', 'processing', 'completed', 'failed'],
    default: 'in_progress',
  },
}, {
  timestamps: true,
});

// Encrypt sensitive fields before saving
ConsultationSchema.pre('save', function (next) {
  if (this.isModified('transcript') && this.transcript) {
    this.transcript = encryptionService.encrypt(this.transcript);
  }
  if (this.isModified('doctorSummary') && this.doctorSummary) {
    this.doctorSummary = encryptionService.encrypt(this.doctorSummary);
  }
  if (this.isModified('patientNote') && this.patientNote) {
    this.patientNote = encryptionService.encrypt(this.patientNote);
  }
  next();
});

// Decrypt sensitive fields after retrieving
ConsultationSchema.post('find', function (docs) {
  if (Array.isArray(docs)) {
    docs.forEach((doc) => {
      if (doc.transcript) {
        doc.transcript = encryptionService.decrypt(doc.transcript);
      }
      if (doc.doctorSummary) {
        doc.doctorSummary = encryptionService.decrypt(doc.doctorSummary);
      }
      if (doc.patientNote) {
        doc.patientNote = encryptionService.decrypt(doc.patientNote);
      }
    });
  }
});

ConsultationSchema.post('findOne', function (doc) {
  if (doc) {
    if (doc.transcript) {
      doc.transcript = encryptionService.decrypt(doc.transcript);
    }
    if (doc.doctorSummary) {
      doc.doctorSummary = encryptionService.decrypt(doc.doctorSummary);
    }
    if (doc.patientNote) {
      doc.patientNote = encryptionService.decrypt(doc.patientNote);
    }
  }
});

ConsultationSchema.post('findOneAndUpdate', function (doc) {
  if (doc) {
    if (doc.transcript) {
      doc.transcript = encryptionService.decrypt(doc.transcript);
    }
    if (doc.doctorSummary) {
      doc.doctorSummary = encryptionService.decrypt(doc.doctorSummary);
    }
    if (doc.patientNote) {
      doc.patientNote = encryptionService.decrypt(doc.patientNote);
    }
  }
});

export default mongoose.model<IConsultation>('Consultation', ConsultationSchema);

