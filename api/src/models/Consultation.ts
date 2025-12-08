import mongoose, { Document, Schema } from 'mongoose';
import { encryptionService } from '../services/encryptionService';

export type ConsultationStatus = 'in_progress' | 'processing' | 'completed' | 'failed';

export interface IConsultation extends Document {
  userId: mongoose.Types.ObjectId;
  transcript: string;
  note: string | null;
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
  transcript: {
    type: String,
    default: '',
  },
  note: {
    type: String,
    default: null,
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
  if (this.isModified('note') && this.note) {
    this.note = encryptionService.encrypt(this.note);
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
      if (doc.note) {
        doc.note = encryptionService.decrypt(doc.note);
      }
    });
  }
});

ConsultationSchema.post('findOne', function (doc) {
  if (doc) {
    if (doc.transcript) {
      doc.transcript = encryptionService.decrypt(doc.transcript);
    }
    if (doc.note) {
      doc.note = encryptionService.decrypt(doc.note);
    }
  }
});

ConsultationSchema.post('findOneAndUpdate', function (doc) {
  if (doc) {
    if (doc.transcript) {
      doc.transcript = encryptionService.decrypt(doc.transcript);
    }
    if (doc.note) {
      doc.note = encryptionService.decrypt(doc.note);
    }
  }
});

export default mongoose.model<IConsultation>('Consultation', ConsultationSchema);

