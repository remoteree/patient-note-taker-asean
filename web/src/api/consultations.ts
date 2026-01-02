import { api } from './client';
import { Consultation, ConsultationLanguage } from '../types';

export const consultationsApi = {
  createConsultation: (patientId: string, language: ConsultationLanguage = 'bn') =>
    api.post<{ consultation: Consultation }>('/consultations', { patientId, language }),
  getConsultations: (patientId?: string) => {
    const url = patientId ? `/consultations?patientId=${patientId}` : '/consultations';
    return api.get<{ consultations: Consultation[] }>(url);
  },
  getConsultation: (id: string) =>
    api.get<{ consultation: Consultation }>(`/consultations/${id}`),
  generateNote: (id: string) =>
    api.post<{ consultation: Consultation }>(`/consultations/${id}/generate-note`),
};



