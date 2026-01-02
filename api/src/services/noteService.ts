import OpenAI from 'openai';

export interface NoteGenerationResult {
  doctorSummary: string; // Legacy field
  patientNote: string; // Legacy field
  doctorSummaryEn: string;
  doctorSummaryLang: string;
  patientNoteEn: string;
  patientNoteLang: string;
  tags: string[];
}

export interface NoteService {
  generateNotes(transcript: string, detectedLanguage?: string): Promise<NoteGenerationResult>;
  translateText(text: string, targetLanguage: string): Promise<string>;
}

class OpenAINoteService implements NoteService {
  private openai: OpenAI | null = null;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    } else {
      console.warn('OPENAI_API_KEY not set. Note generation will not work.');
    }
  }

  /**
   * Translate text to target language using OpenAI
   */
  async translateText(text: string, targetLanguage: string): Promise<string> {
    if (!this.openai) {
      throw new Error('OpenAI API key not configured');
    }

    if (!text || text.trim().length === 0) {
      return text;
    }

    // Map language codes to language names
    const languageMap: Record<string, string> = {
      'bn': 'Bengali',
      'en': 'English',
      'th': 'Thai',
      'ms': 'Malay',
    };

    const targetLangName = languageMap[targetLanguage] || targetLanguage;

    try {
      const completion = await this.openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are a professional medical translator. Translate the following medical text to ${targetLangName} while maintaining medical accuracy and terminology. Keep the structure and formatting intact.`,
          },
          {
            role: 'user',
            content: `Translate the following text to ${targetLangName}:\n\n${text}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      });

      const translated = completion.choices[0]?.message?.content;
      return translated || text;
    } catch (error: any) {
      console.error(`[TRANSLATION] Error translating to ${targetLangName}:`, error);
      // Return original text if translation fails
      return text;
    }
  }

  async generateNotes(transcript: string, detectedLanguage?: string): Promise<NoteGenerationResult> {
    if (!this.openai) {
      throw new Error('OpenAI API key not configured. Please set OPENAI_API_KEY environment variable.');
    }

    if (!transcript || transcript.trim().length === 0) {
      throw new Error('Transcript is empty');
    }

    const systemPrompt = `You are a medical assistant that helps doctors create structured clinical documentation from consultation transcripts.
You will generate two separate documents:
1. A detailed clinical summary for the doctor (with searchable tags)
2. A clear, patient-friendly note with instructions

For the doctor summary, use SOAP format and include relevant medical terminology.
For the patient note, use plain language and focus on clear instructions and follow-up actions.
Extract relevant tags for easy searching (e.g., diagnosis codes, symptoms, conditions, medications).`;

    const userPrompt = `Please generate both documents from the following consultation transcript:

${transcript}

Generate the response in the following JSON format:
{
  "doctorSummary": "Detailed SOAP format note with:\n\nSUBJECTIVE:\n[Patient's reported symptoms, history, concerns]\n\nOBJECTIVE:\n[Observable findings, vital signs, examination findings]\n\nASSESSMENT:\n[Clinical assessment, diagnosis, differential diagnosis]\n\nPLAN:\n[Treatment plan, medications, follow-up instructions, referrals]",
  "patientNote": "Clear, patient-friendly note with:\n- Brief summary of what was discussed\n- Clear indications/diagnosis in plain language\n- Specific instructions for the patient\n- Follow-up actions and when to return\n- Medication instructions if applicable\n- Any warnings or important information",
  "tags": ["tag1", "tag2", "tag3"]
}

The tags should be relevant medical terms, diagnoses, symptoms, or conditions mentioned in the consultation. Use 3-8 tags.`;

    try {
      // Use gpt-4o or gpt-4-turbo which support structured outputs, fallback to gpt-4 without response_format
      const model = process.env.OPENAI_MODEL || 'gpt-4o';
      const supportsJsonFormat = ['gpt-4o', 'gpt-4-turbo', 'gpt-4o-mini'].includes(model);
      
      const completion = await this.openai.chat.completions.create({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 3000,
        ...(supportsJsonFormat ? { response_format: { type: 'json_object' } } : {}),
      });

      const response = completion.choices[0]?.message?.content;
      if (!response) {
        throw new Error('No response from OpenAI');
      }

      // Parse JSON response - if response_format was used, it's already JSON, otherwise parse from text
      let parsed: any;
      if (supportsJsonFormat) {
        parsed = JSON.parse(response);
      } else {
        // Extract JSON from text response if model doesn't support response_format
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('Could not parse JSON from OpenAI response');
        }
      }
      
      if (!parsed.doctorSummary || !parsed.patientNote || !Array.isArray(parsed.tags)) {
        throw new Error('Invalid response format from OpenAI');
      }

      const doctorSummaryEn = parsed.doctorSummary;
      const patientNoteEn = parsed.patientNote;

      // Translate summaries to detected language if provided and not English
      let doctorSummaryLang = doctorSummaryEn;
      let patientNoteLang = patientNoteEn;

      if (detectedLanguage && detectedLanguage !== 'en' && detectedLanguage !== 'auto') {
        console.log(`[NOTE-SERVICE] Translating summaries to ${detectedLanguage}...`);
        try {
          // Translate both summaries in parallel
          [doctorSummaryLang, patientNoteLang] = await Promise.all([
            this.translateText(doctorSummaryEn, detectedLanguage),
            this.translateText(patientNoteEn, detectedLanguage),
          ]);
          console.log(`[NOTE-SERVICE] Successfully translated summaries to ${detectedLanguage}`);
        } catch (error: any) {
          console.error(`[NOTE-SERVICE] Error translating summaries:`, error);
          // Keep English versions if translation fails
        }
      }

      return {
        doctorSummary: doctorSummaryEn, // Legacy field - same as English
        patientNote: patientNoteEn, // Legacy field - same as English
        doctorSummaryEn,
        doctorSummaryLang,
        patientNoteEn,
        patientNoteLang,
        tags: parsed.tags,
      };
    } catch (error: any) {
      console.error('OpenAI API error:', error);
      throw new Error(`Failed to generate notes: ${error.message || 'Unknown error'}`);
    }
  }
}

export const noteService = new OpenAINoteService();

/**
 * Generate summaries in the background when transcription completes
 * This function runs asynchronously and doesn't block the transcription completion
 */
export async function generateSummariesInBackground(
  consultationId: string,
  transcript: string,
  detectedLanguage?: string | null
): Promise<void> {
  // Run in background - don't await, just fire and forget
  setImmediate(async () => {
    try {
      const Consultation = (await import('../models/Consultation')).default;
      
      // Get consultation to check if summaries already exist
      const consultation = await Consultation.findById(consultationId);
      if (!consultation) {
        console.warn(`[SUMMARY-GEN] Consultation ${consultationId} not found, skipping summary generation`);
        return;
      }

      // Skip if transcript is empty or too short
      if (!transcript || transcript.trim().length < 50) {
        console.log(`[SUMMARY-GEN] Transcript too short for ${consultationId}, skipping summary generation`);
        return;
      }

      // Skip if summaries already exist
      if (consultation.doctorSummaryEn || consultation.patientNoteEn) {
        console.log(`[SUMMARY-GEN] Summaries already exist for ${consultationId}, skipping`);
        return;
      }

      console.log(`[SUMMARY-GEN] Starting background summary generation for consultation ${consultationId}`);
      
      // Determine language to use for translation
      // Priority: detectedLanguage > consultation.language (if not 'auto') > 'en'
      let languageForTranslation: string | undefined;
      if (detectedLanguage && detectedLanguage !== 'auto') {
        languageForTranslation = detectedLanguage;
      } else if (consultation.language && consultation.language !== 'auto') {
        languageForTranslation = consultation.language;
      }

      // Generate summaries
      const result = await noteService.generateNotes(transcript, languageForTranslation);

      // Update consultation with summaries and detected language
      consultation.doctorSummary = result.doctorSummary; // Legacy field
      consultation.patientNote = result.patientNote; // Legacy field
      consultation.doctorSummaryEn = result.doctorSummaryEn;
      consultation.doctorSummaryLang = result.doctorSummaryLang;
      consultation.patientNoteEn = result.patientNoteEn;
      consultation.patientNoteLang = result.patientNoteLang;
      consultation.tags = result.tags;
      
      // Update detected language if provided
      if (detectedLanguage && detectedLanguage !== 'auto') {
        consultation.detectedLanguage = detectedLanguage;
      } else if (languageForTranslation) {
        consultation.detectedLanguage = languageForTranslation;
      }

      await consultation.save();
      console.log(`[SUMMARY-GEN] Successfully generated summaries for consultation ${consultationId}`);
    } catch (error: any) {
      console.error(`[SUMMARY-GEN] Error generating summaries for consultation ${consultationId}:`, error);
      // Don't throw - this is background processing, errors shouldn't affect transcription
    }
  });
}
