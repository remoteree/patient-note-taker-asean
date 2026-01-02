import { api } from './client';
import { Patient } from '../types';

export const patientsApi = {
  searchPatients: (query: string) =>
    api.get<{ patients: Patient[] }>(`/patients/search?query=${encodeURIComponent(query)}`),
  getPatient: (id: string) =>
    api.get<{ patient: Patient }>(`/patients/${id}`),
  createPatient: (data: { name: string; dateOfBirth: string; mrn: string }) =>
    api.post<{ patient: Patient }>('/patients', data),
};





