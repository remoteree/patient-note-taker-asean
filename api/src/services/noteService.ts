import OpenAI from 'openai';

export interface NoteService {
  generateNote(transcript: string): Promise<string>;
}

class OpenAINoteService implements NoteService {
  private openai: OpenAI | null = null;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    console.log('\n[OpenAINoteService] Initializing...');
    console.log(`[OpenAINoteService] Checking OPENAI_API_KEY from process.env...`);
    console.log(`[OpenAINoteService] process.env.OPENAI_API_KEY type: ${typeof apiKey}`);
    console.log(`[OpenAINoteService] process.env.OPENAI_API_KEY exists: ${apiKey !== undefined}`);
    console.log(`[OpenAINoteService] process.env.OPENAI_API_KEY is truthy: ${!!apiKey}`);
    console.log(`[OpenAINoteService] process.env.OPENAI_API_KEY length: ${apiKey?.length || 0}`);
    
    if (apiKey) {
      const masked = apiKey.length > 8 
        ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}` 
        : '***';
      console.log(`[OpenAINoteService] ✓ OPENAI_API_KEY found (${masked}, length: ${apiKey.length})`);
      console.log(`[OpenAINoteService] Initializing OpenAI client...`);
      try {
        this.openai = new OpenAI({ apiKey });
        console.log(`[OpenAINoteService] ✓ OpenAI client initialized successfully`);
      } catch (error) {
        console.error(`[OpenAINoteService] ✗ Failed to initialize OpenAI client:`, error);
      }
    } else {
      console.warn('[OpenAINoteService] ✗ OPENAI_API_KEY not set. Note generation will not work.');
      console.warn('[OpenAINoteService] Available env vars:', Object.keys(process.env).filter(k => k.includes('OPENAI')));
    }
    console.log('[OpenAINoteService] Initialization complete\n');
  }

  async generateNote(transcript: string): Promise<string> {
    if (!this.openai) {
      throw new Error('OpenAI API key not configured. Please set OPENAI_API_KEY environment variable.');
    }

    if (!transcript || transcript.trim().length === 0) {
      throw new Error('Transcript is empty');
    }

    const systemPrompt = `You are a medical assistant that helps doctors create structured clinical notes from consultation transcripts. 
Generate a professional SOAP (Subjective, Objective, Assessment, Plan) format clinical note based on the consultation transcript.
Focus on extracting key medical information, symptoms, observations, assessments, and treatment plans.
Keep the note concise, professional, and clinically accurate.`;

    const userPrompt = `Please generate a structured clinical note in SOAP format from the following consultation transcript:

${transcript}

Format the note as follows:

SUBJECTIVE:
[Patient's reported symptoms, history, and concerns]

OBJECTIVE:
[Observable findings, vital signs if mentioned, examination findings]

ASSESSMENT:
[Clinical assessment, diagnosis, or differential diagnosis]

PLAN:
[Treatment plan, medications, follow-up instructions, referrals if any]`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      });

      const note = completion.choices[0]?.message?.content;
      if (!note) {
        throw new Error('No response from OpenAI');
      }

      return note;
    } catch (error: any) {
      console.error('OpenAI API error:', error);
      throw new Error(`Failed to generate note: ${error.message || 'Unknown error'}`);
    }
  }
}

export const noteService = new OpenAINoteService();
