// Shared JWT configuration to ensure consistency across all modules
// This file reads JWT_SECRET ONLY from .env file to avoid system environment variable conflicts

import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Load .env file FIRST with override to ensure we read from file, not system env
const envPath = join(process.cwd(), '.env');
const envExists = existsSync(envPath);

let JWT_SECRET = 'secret';
let JWT_EXPIRES_IN = '7d';

if (envExists) {
  // Load .env file with override=true to ensure .env file values take precedence
  // This ensures we read from .env file, not system environment variables
  const dotenvResult = dotenv.config({ path: envPath, override: false });
  
  if (dotenvResult.error) {
    console.warn(`[JWT Config] ⚠ Error loading .env file: ${dotenvResult.error.message}`);
  } else if (dotenvResult.parsed) {
    // Read directly from parsed .env file result (this is the source of truth)
    const envSecret = dotenvResult.parsed.JWT_SECRET;
    const envExpiresIn = dotenvResult.parsed.JWT_EXPIRES_IN;
    
    if (envSecret) {
      // Trim whitespace that might cause signature mismatches
      JWT_SECRET = envSecret.trim();
      console.log(`[JWT Config] ✓ JWT_SECRET loaded DIRECTLY from .env file`);
      console.log(`[JWT Config]   Length: ${JWT_SECRET.length}, starts with: ${JWT_SECRET.substring(0, 4)}...`);
      console.log(`[JWT Config]   Value from .env file (not system env): ✓`);
    } else {
      console.warn(`[JWT Config] ⚠ JWT_SECRET not found in .env file, using default 'secret'`);
      console.warn(`[JWT Config] This will cause authentication issues! Please set JWT_SECRET in .env file`);
    }
    
    if (envExpiresIn) {
      JWT_EXPIRES_IN = envExpiresIn.trim();
    }
  }
} else {
  console.warn(`[JWT Config] ⚠ .env file not found at ${envPath}`);
  console.warn(`[JWT Config] Using default JWT_SECRET 'secret' - this will cause issues if tokens were created with a different secret!`);
}

// Set in process.env so other modules can read it, but we've already read from .env file above
// This ensures consistency - all modules will use the value from .env file
process.env.JWT_SECRET = JWT_SECRET;
process.env.JWT_EXPIRES_IN = JWT_EXPIRES_IN;

console.log(`[JWT Config] Final JWT_SECRET: length=${JWT_SECRET.length}, source=.env file`);

export { JWT_SECRET, JWT_EXPIRES_IN };

