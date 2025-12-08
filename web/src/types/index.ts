export interface User {
  id: string;
  email: string;
  name: string;
  specialization: string;
  clinicName: string;
  country: string;
}

export interface Patient {
  id: string;
  name: string;
  dateOfBirth: string;
  mrn: string;
  createdAt: string;
  updatedAt: string;
}

export type ConsultationStatus = 'in_progress' | 'processing' | 'completed' | 'failed';

export interface Consultation {
  id: string;
  userId: string;
  patientId: string;
  patient?: Patient;
  transcript: string;
  doctorSummary: string | null;
  patientNote: string | null;
  tags: string[];
  status: ConsultationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WebSocketMessage {
  type: string;
  consultationId?: string;
  transcript?: string;
}



