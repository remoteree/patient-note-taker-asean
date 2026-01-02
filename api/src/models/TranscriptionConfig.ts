import mongoose, { Document, Schema } from 'mongoose';

export type CloudProvider = 'aws' | 'deepgram' | 'elevenlabs';

export interface ITranscriptionConfig extends Document {
  language: string; // 'bn', 'en', 'th', 'ms', 'auto'
  cloudProvider: CloudProvider;
  enabled: boolean;
  config: {
    // Provider-specific configuration
    model?: string;
    languageCode?: string;
    enableLanguageDetection?: boolean;
    [key: string]: any;
  };
  createdAt: Date;
  updatedAt: Date;
}

const TranscriptionConfigSchema = new Schema<ITranscriptionConfig>({
  language: {
    type: String,
    required: true,
    unique: true,
    enum: ['bn', 'en', 'th', 'ms', 'auto'],
  },
  cloudProvider: {
    type: String,
    enum: ['aws', 'deepgram', 'elevenlabs'],
    default: 'elevenlabs',
    required: true,
  },
  enabled: {
    type: Boolean,
    default: true,
  },
  config: {
    type: Schema.Types.Mixed,
    default: {},
  },
}, {
  timestamps: true,
});

// Create default configurations on first load
TranscriptionConfigSchema.statics.initializeDefaults = async function() {
  const defaults = [
    { language: 'bn', cloudProvider: 'elevenlabs' },
    { language: 'en', cloudProvider: 'deepgram' },
    { language: 'th', cloudProvider: 'elevenlabs' },
    { language: 'ms', cloudProvider: 'elevenlabs' },
    { language: 'auto', cloudProvider: 'deepgram' },
  ];

  for (const defaultConfig of defaults) {
    await this.findOneAndUpdate(
      { language: defaultConfig.language },
      defaultConfig,
      { upsert: true, new: true }
    );
  }
};

// Add static method type definition
interface TranscriptionConfigModel extends mongoose.Model<ITranscriptionConfig> {
  initializeDefaults(): Promise<void>;
}

export default mongoose.model<ITranscriptionConfig, TranscriptionConfigModel>('TranscriptionConfig', TranscriptionConfigSchema);

