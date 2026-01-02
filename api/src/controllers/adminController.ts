import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import TranscriptionConfig, { CloudProvider } from '../models/TranscriptionConfig';

export const getTranscriptionConfigs = async (req: AuthRequest, res: Response) => {
  try {
    let configs = await TranscriptionConfig.find().sort({ language: 1 });
    
    // If no configs exist, initialize defaults
    if (configs.length === 0) {
      console.log('[ADMIN] No transcription configs found, initializing defaults...');
      await TranscriptionConfig.initializeDefaults();
      configs = await TranscriptionConfig.find().sort({ language: 1 });
    }
    
    res.json({ configs });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getTranscriptionConfig = async (req: AuthRequest, res: Response) => {
  try {
    const { language } = req.params;
    const config = await TranscriptionConfig.findOne({ language });
    
    if (!config) {
      return res.status(404).json({ error: 'Transcription config not found for this language' });
    }
    
    res.json({ config });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const updateTranscriptionConfig = async (req: AuthRequest, res: Response) => {
  try {
    const { language } = req.params;
    const { cloudProvider, enabled, config } = req.body;

    // Validate inputs
    if (cloudProvider && !['aws', 'deepgram', 'elevenlabs'].includes(cloudProvider)) {
      return res.status(400).json({ error: 'Invalid cloud provider. Must be one of: aws, deepgram, elevenlabs' });
    }

    const updateData: any = {};
    if (cloudProvider !== undefined) updateData.cloudProvider = cloudProvider;
    if (enabled !== undefined) updateData.enabled = enabled;
    if (config !== undefined) updateData.config = config;

    const updatedConfig = await TranscriptionConfig.findOneAndUpdate(
      { language },
      updateData,
      { new: true, upsert: true }
    );

    res.json({ config: updatedConfig });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const resetTranscriptionConfigs = async (req: AuthRequest, res: Response) => {
  try {
    // Delete all configs and recreate defaults
    await TranscriptionConfig.deleteMany({});
    await TranscriptionConfig.initializeDefaults();
    
    const configs = await TranscriptionConfig.find().sort({ language: 1 });
    res.json({ 
      message: 'Transcription configs reset to defaults',
      configs 
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};


