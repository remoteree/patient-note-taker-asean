import mongoose, { Document, Schema } from 'mongoose';
import { encryptionService } from '../services/encryptionService';

export type ConsultationStatus = 'in_progress' | 'processing' | 'completed' | 'failed' | 'partial';
export type TranscriptionMode = 'cloud';
export type ConsultationLanguage = 'bn' | 'en' | 'th' | 'ms' | 'auto'; // Bengali, English, Thai, Malay, or Auto-detect

export interface IConsultation extends Document {
  userId: mongoose.Types.ObjectId;
  patientId: mongoose.Types.ObjectId;
  transcript: string;
  doctorSummary: string | null; // Legacy field - kept for backward compatibility
  patientNote: string | null; // Legacy field - kept for backward compatibility
  // New multi-language summary fields
  doctorSummaryEn: string | null; // Doctor summary in English
  doctorSummaryLang: string | null; // Doctor summary in detected language
  patientNoteEn: string | null; // Patient note in English
  patientNoteLang: string | null; // Patient note in detected language
  detectedLanguage: string | null; // Detected language code (bn, en, th, ms)
  tags: string[];
  status: ConsultationStatus;
  transcriptionMode: TranscriptionMode;
  language: ConsultationLanguage; // Required language selection
  // Batch transcription tracking fields
  processedChunks?: number;
  totalChunks?: number;
  transcriptionProgress?: number; // 0-100
  lastChunkProcessed?: string; // Last chunk filename processed
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
  doctorSummaryEn: {
    type: String,
    default: null,
  },
  doctorSummaryLang: {
    type: String,
    default: null,
  },
  patientNoteEn: {
    type: String,
    default: null,
  },
  patientNoteLang: {
    type: String,
    default: null,
  },
  detectedLanguage: {
    type: String,
    default: null,
  },
  tags: {
    type: [String],
    default: [],
  },
  status: {
    type: String,
    enum: ['in_progress', 'processing', 'completed', 'failed', 'partial'],
    default: 'in_progress',
  },
  processedChunks: {
    type: Number,
    default: 0,
  },
  totalChunks: {
    type: Number,
    default: 0,
  },
  transcriptionProgress: {
    type: Number,
    default: 0,
  },
  lastChunkProcessed: {
    type: String,
    default: null,
  },
  transcriptionMode: {
    type: String,
    enum: ['cloud'],
    default: 'cloud',
  },
  language: {
    type: String,
    enum: ['bn', 'en', 'th', 'ms', 'auto'],
    required: true,
  },
}, {
  timestamps: true,
});

// Encrypt sensitive fields before saving
ConsultationSchema.pre('save', function (next) {
  try {
    if (this.isModified('transcript') && this.transcript) {
      this.transcript = encryptionService.encrypt(this.transcript);
    }
    if (this.isModified('doctorSummary') && this.doctorSummary) {
      this.doctorSummary = encryptionService.encrypt(this.doctorSummary);
    }
    if (this.isModified('patientNote') && this.patientNote) {
      this.patientNote = encryptionService.encrypt(this.patientNote);
    }
    if (this.isModified('doctorSummaryEn') && this.doctorSummaryEn) {
      this.doctorSummaryEn = encryptionService.encrypt(this.doctorSummaryEn);
    }
    if (this.isModified('doctorSummaryLang') && this.doctorSummaryLang) {
      this.doctorSummaryLang = encryptionService.encrypt(this.doctorSummaryLang);
    }
    if (this.isModified('patientNoteEn') && this.patientNoteEn) {
      this.patientNoteEn = encryptionService.encrypt(this.patientNoteEn);
    }
    if (this.isModified('patientNoteLang') && this.patientNoteLang) {
      this.patientNoteLang = encryptionService.encrypt(this.patientNoteLang);
    }
  } catch (error) {
    console.error('Error encrypting consultation fields:', error);
    // Continue saving even if encryption fails (data will be stored unencrypted)
  }
  next();
});

// Decrypt sensitive fields after retrieving
const decryptFields = (doc: any) => {
  if (!doc) return;
  if (doc.transcript) {
    doc.transcript = encryptionService.decrypt(doc.transcript);
  }
  if (doc.doctorSummary) {
    doc.doctorSummary = encryptionService.decrypt(doc.doctorSummary);
  }
  if (doc.patientNote) {
    doc.patientNote = encryptionService.decrypt(doc.patientNote);
  }
  if (doc.doctorSummaryEn) {
    doc.doctorSummaryEn = encryptionService.decrypt(doc.doctorSummaryEn);
  }
  if (doc.doctorSummaryLang) {
    doc.doctorSummaryLang = encryptionService.decrypt(doc.doctorSummaryLang);
  }
  if (doc.patientNoteEn) {
    doc.patientNoteEn = encryptionService.decrypt(doc.patientNoteEn);
  }
  if (doc.patientNoteLang) {
    doc.patientNoteLang = encryptionService.decrypt(doc.patientNoteLang);
  }
};

ConsultationSchema.post('find', function (docs) {
  if (Array.isArray(docs)) {
    docs.forEach(decryptFields);
  }
});

ConsultationSchema.post('findOne', function (doc) {
  decryptFields(doc);
});

ConsultationSchema.post('findOneAndUpdate', function (doc) {
  decryptFields(doc);
});

export default mongoose.model<IConsultation>('Consultation', ConsultationSchema);

