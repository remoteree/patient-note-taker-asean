#!/usr/bin/env ts-node

/**
 * Script to delete consultations where no transcription was saved
 * 
 * Usage:
 *   ts-node scripts/delete-consultations-without-transcript.ts [--dry-run] [--cleanup-files]
 * 
 * Options:
 *   --dry-run: Preview what would be deleted without actually deleting
 *   --cleanup-files: Also delete associated audio recording files
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { readdir, unlink, stat } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import Consultation from '../src/models/Consultation';
import * as readline from 'readline';

// Load environment variables
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/doc-ai';
const RECORDINGS_DIR = join(process.cwd(), 'recordings');

interface ConsultationInfo {
  id: string;
  userId: string;
  patientId: string;
  status: string;
  language: string;
  createdAt: Date;
  updatedAt: Date;
  transcriptLength: number;
}

/**
 * Check if transcript is empty
 * Note: Transcripts are automatically decrypted by the model's post hook
 */
function isTranscriptEmpty(transcript: string | null | undefined): boolean {
  if (!transcript) return true;
  return transcript.trim().length === 0;
}

/**
 * Find all consultations without transcripts
 */
async function findConsultationsWithoutTranscript(): Promise<ConsultationInfo[]> {
  console.log('🔍 Searching for consultations without transcripts...\n');
  
  // Get all consultations (not using lean() so decryption hooks run)
  const consultations = await Consultation.find({});
  
  const consultationsWithoutTranscript: ConsultationInfo[] = [];
  
  for (const consultation of consultations) {
    try {
      // Transcript is already decrypted by the post hook
      const transcript = consultation.transcript as string | null | undefined;
      
      if (isTranscriptEmpty(transcript)) {
        // Safely convert ObjectIds to strings (handle both ObjectId instances and populated references)
        let userId = 'unknown';
        let patientId = 'unknown';
        
        try {
          userId = consultation.userId 
            ? (consultation.userId.toString ? consultation.userId.toString() : String(consultation.userId))
            : 'unknown';
        } catch (e) {
          console.warn(`Failed to get userId for consultation ${consultation._id}:`, e);
        }
        
        try {
          patientId = consultation.patientId 
            ? (consultation.patientId.toString ? consultation.patientId.toString() : String(consultation.patientId))
            : 'unknown';
        } catch (e) {
          console.warn(`Failed to get patientId for consultation ${consultation._id}:`, e);
        }
        
        consultationsWithoutTranscript.push({
          id: consultation._id.toString(),
          userId,
          patientId,
          status: consultation.status || 'unknown',
          language: consultation.language || 'unknown',
          createdAt: consultation.createdAt || new Date(),
          updatedAt: consultation.updatedAt || new Date(),
          transcriptLength: transcript ? transcript.length : 0,
        });
      }
    } catch (error) {
      console.error(`Error processing consultation ${consultation._id}:`, error);
      // Continue with next consultation
    }
  }
  
  return consultationsWithoutTranscript;
}

/**
 * Find audio files associated with a consultation
 */
async function findAudioFiles(consultationId: string): Promise<string[]> {
  if (!existsSync(RECORDINGS_DIR)) {
    return [];
  }
  
  try {
    const files = await readdir(RECORDINGS_DIR);
    return files
      .filter(file => file.includes(consultationId))
      .map(file => join(RECORDINGS_DIR, file));
  } catch (error) {
    console.warn(`⚠️  Error reading recordings directory: ${error}`);
    return [];
  }
}

/**
 * Delete audio files for consultations
 */
async function deleteAudioFiles(consultationIds: string[]): Promise<number> {
  let deletedCount = 0;
  let totalSize = 0;
  
  for (const consultationId of consultationIds) {
    const files = await findAudioFiles(consultationId);
    
    for (const filePath of files) {
      try {
        const stats = await stat(filePath);
        totalSize += stats.size;
        await unlink(filePath);
        deletedCount++;
        console.log(`  🗑️  Deleted: ${filePath}`);
      } catch (error) {
        console.warn(`  ⚠️  Failed to delete ${filePath}: ${error}`);
      }
    }
  }
  
  return deletedCount;
}

/**
 * Format bytes to human readable size
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const cleanupFiles = args.includes('--cleanup-files');
  
  try {
    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Find consultations without transcripts
    const consultationsWithoutTranscript = await findConsultationsWithoutTranscript();
    
    if (consultationsWithoutTranscript.length === 0) {
      console.log('✅ No consultations found without transcripts.');
      await mongoose.disconnect();
      return;
    }
    
    // Display summary
    console.log(`📊 Found ${consultationsWithoutTranscript.length} consultation(s) without transcripts:\n`);
    
    // Group by status
    const byStatus: Record<string, ConsultationInfo[]> = {};
    consultationsWithoutTranscript.forEach(consultation => {
      if (!byStatus[consultation.status]) {
        byStatus[consultation.status] = [];
      }
      byStatus[consultation.status].push(consultation);
    });
    
    console.log('Status breakdown:');
    Object.entries(byStatus).forEach(([status, consultations]) => {
      console.log(`  ${status}: ${consultations.length}`);
    });
    console.log('');
    
    // Show sample consultations (first 10)
    console.log('Sample consultations to be deleted:');
    consultationsWithoutTranscript.slice(0, 10).forEach((consultation, index) => {
      const age = Math.floor((Date.now() - consultation.createdAt.getTime()) / (1000 * 60 * 60 * 24));
      console.log(`  ${index + 1}. ID: ${consultation.id}`);
      console.log(`     Status: ${consultation.status}, Language: ${consultation.language}`);
      console.log(`     Created: ${consultation.createdAt.toISOString()} (${age} days ago)`);
      console.log(`     Transcript length: ${consultation.transcriptLength} bytes\n`);
    });
    
    if (consultationsWithoutTranscript.length > 10) {
      console.log(`  ... and ${consultationsWithoutTranscript.length - 10} more\n`);
    }
    
    // Check for audio files if cleanup requested
    let audioFilesCount = 0;
    if (cleanupFiles) {
      console.log('🔍 Checking for associated audio files...');
      const consultationIds = consultationsWithoutTranscript.map(c => c.id);
      const allFiles: string[] = [];
      
      for (const consultationId of consultationIds) {
        const files = await findAudioFiles(consultationId);
        allFiles.push(...files);
      }
      
      audioFilesCount = allFiles.length;
      if (audioFilesCount > 0) {
        console.log(`📁 Found ${audioFilesCount} audio file(s) to delete\n`);
      } else {
        console.log('📁 No audio files found\n');
      }
    }
    
    // Confirm deletion
    if (dryRun) {
      console.log('🔍 DRY RUN MODE - No deletions will be performed');
      console.log(`\nWould delete:`);
      console.log(`  - ${consultationsWithoutTranscript.length} consultation(s)`);
      if (cleanupFiles) {
        console.log(`  - ${audioFilesCount} audio file(s)`);
      }
    } else {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      
      const answer = await new Promise<string>((resolve) => {
        rl.question(
          `⚠️  Are you sure you want to delete ${consultationsWithoutTranscript.length} consultation(s)${cleanupFiles && audioFilesCount > 0 ? ` and ${audioFilesCount} audio file(s)` : ''}? (yes/no): `,
          resolve
        );
      });
      
      rl.close();
      
      if (answer.toLowerCase() !== 'yes') {
        console.log('❌ Deletion cancelled.');
        await mongoose.disconnect();
        return;
      }
      
      // Delete audio files first if requested
      if (cleanupFiles && audioFilesCount > 0) {
        console.log('\n🗑️  Deleting audio files...');
        const consultationIds = consultationsWithoutTranscript.map(c => c.id);
        await deleteAudioFiles(consultationIds);
        console.log(`✅ Deleted ${audioFilesCount} audio file(s)\n`);
      }
      
      // Delete consultations
      console.log('🗑️  Deleting consultations...');
      const consultationIds = consultationsWithoutTranscript.map(c => c.id);
      const result = await Consultation.deleteMany({
        _id: { $in: consultationIds.map(id => new mongoose.Types.ObjectId(id)) },
      });
      
      console.log(`✅ Deleted ${result.deletedCount} consultation(s)`);
    }
    
    console.log('\n✅ Script completed successfully');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

// Run the script
main();

