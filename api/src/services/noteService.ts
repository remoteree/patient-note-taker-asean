import OpenAI from 'openai';

export interface NoteGenerationResult {
  doctorSummary: string;
  patientNote: string;
  tags: string[];
}

export interface NoteService {
  generateNotes(transcript: string): Promise<NoteGenerationResult>;
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

  async generateNotes(transcript: string): Promise<NoteGenerationResult> {
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
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 3000,
        response_format: { type: 'json_object' },
      });

      const response = completion.choices[0]?.message?.content;
      if (!response) {
        throw new Error('No response from OpenAI');
      }

      const parsed = JSON.parse(response);
      
      if (!parsed.doctorSummary || !parsed.patientNote || !Array.isArray(parsed.tags)) {
        throw new Error('Invalid response format from OpenAI');
      }

      return {
        doctorSummary: parsed.doctorSummary,
        patientNote: parsed.patientNote,
        tags: parsed.tags,
      };
    } catch (error: any) {
      console.error('OpenAI API error:', error);
      throw new Error(`Failed to generate notes: ${error.message || 'Unknown error'}`);
    }
  }
}

export const noteService = new OpenAINoteService();
