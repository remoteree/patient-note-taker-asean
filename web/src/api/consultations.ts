import { api } from './client';
import { Consultation } from '../types';

export const consultationsApi = {
  createConsultation: () =>
    api.post<{ consultation: Consultation }>('/consultations'),
  getConsultations: () =>
    api.get<{ consultations: Consultation[] }>('/consultations'),
  getConsultation: (id: string) =>
    api.get<{ consultation: Consultation }>(`/consultations/${id}`),
  generateNote: (id: string) =>
    api.post<{ consultation: Consultation }>(`/consultations/${id}/generate-note`),
};



