import { api } from './client';

export type CloudProvider = 'aws' | 'deepgram' | 'elevenlabs';

export interface TranscriptionConfig {
  _id: string;
  language: 'bn' | 'en' | 'th' | 'ms' | 'auto';
  cloudProvider: CloudProvider;
  enabled: boolean;
  config: {
    model?: string;
    languageCode?: string;
    enableLanguageDetection?: boolean;
    [key: string]: any;
  };
  createdAt: string;
  updatedAt: string;
}

interface TranscriptionConfigsResponse {
  configs: TranscriptionConfig[];
}

interface TranscriptionConfigResponse {
  config: TranscriptionConfig;
}

interface ResetConfigsResponse {
  message: string;
  configs: TranscriptionConfig[];
}

export const adminApi = {
  getTranscriptionConfigs: () =>
    api.get<TranscriptionConfigsResponse>('/admin/transcription-configs'),

  getTranscriptionConfig: (language: string) =>
    api.get<TranscriptionConfigResponse>(`/admin/transcription-configs/${language}`),

  updateTranscriptionConfig: (
    language: string,
    data: {
      cloudProvider?: CloudProvider;
      enabled?: boolean;
      config?: Record<string, any>;
    }
  ) =>
    api.put<TranscriptionConfigResponse>(`/admin/transcription-configs/${language}`, data),

  resetTranscriptionConfigs: () =>
    api.post<ResetConfigsResponse>('/admin/transcription-configs/reset'),
};

