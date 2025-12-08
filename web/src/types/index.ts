export interface User {
  id: string;
  email: string;
  name: string;
  specialization: string;
  clinicName: string;
  country: string;
}

export type ConsultationStatus = 'in_progress' | 'processing' | 'completed' | 'failed';

export interface Consultation {
  id: string;
  userId: string;
  transcript: string;
  note: string | null;
  status: ConsultationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WebSocketMessage {
  type: string;
  consultationId?: string;
  transcript?: string;
}



