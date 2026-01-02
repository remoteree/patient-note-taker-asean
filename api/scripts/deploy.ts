import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, statSync, readdirSync, lstatSync } from 'fs';
import { join, resolve } from 'path';
import { createWriteStream } from 'fs';
import archiver from 'archiver';

const rootDir = resolve(__dirname, '../..');
const apiDir = resolve(__dirname, '..');
const webDir = resolve(rootDir, 'web');
const distDir = resolve(apiDir, 'dist');
const publicDir = resolve(distDir, 'public');
const deployDir = resolve(apiDir, 'deploy');
const envFile = resolve(apiDir, '.env');
const envExampleFile = resolve(apiDir, 'env.example');

console.log('🚀 Starting deployment build...\n');

// Step 1: Build frontend
console.log('📦 Step 1: Building frontend...');
try {
  process.chdir(webDir);
  execSync('npm run build', { stdio: 'inherit' });
  console.log('✓ Frontend build completed\n');
} catch (error) {
  console.error('✗ Frontend build failed:', error);
  process.exit(1);
}

// Step 2: Copy frontend build to backend public directory
console.log('📁 Step 2: Copying frontend build to backend...');
const webDistDir = resolve(webDir, 'dist');
if (!existsSync(webDistDir)) {
  console.error('✗ Frontend dist directory not found');
  process.exit(1);
}

// Ensure public directory exists
if (!existsSync(publicDir)) {
  mkdirSync(publicDir, { recursive: true });
}

// Copy frontend build contents to backend public
// List all files in webDistDir and copy them
const webDistFiles = readdirSync(webDistDir);
for (const file of webDistFiles) {
  const source = join(webDistDir, file);
  const dest = join(publicDir, file);
  if (lstatSync(source).isDirectory()) {
    cpSync(source, dest, { recursive: true });
  } else {
    cpSync(source, dest);
  }
}
console.log('✓ Frontend files copied to backend public directory\n');

// Step 3: Build backend
console.log('🔨 Step 3: Building backend...');
try {
  process.chdir(apiDir);
  execSync('npm run build', { stdio: 'inherit' });
  console.log('✓ Backend build completed\n');
} catch (error) {
  console.error('✗ Backend build failed:', error);
  process.exit(1);
}

// Step 4: Create environment.config from .env
console.log('⚙️  Step 4: Creating environment.config...');
let envVars: Record<string, string> = {};

// Read .env file if it exists, otherwise use env.example
const envSourceFile = existsSync(envFile) ? envFile : envExampleFile;
if (existsSync(envSourceFile)) {
  const envContent = readFileSync(envSourceFile, 'utf-8');
  const lines = envContent.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    
    // Parse KEY=VALUE
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      // Remove quotes if present
      const cleanValue = value.replace(/^["']|["']$/g, '');
      envVars[key] = cleanValue;
    }
  }
} else {
  console.warn('⚠️  No .env or env.example file found, creating empty environment.config');
}

// Create environment.config in Elastic Beanstalk format
// .ebextensions needs to be at the root of the deployment package
const ebextensionsDir = resolve(apiDir, '.ebextensions');
mkdirSync(ebextensionsDir, { recursive: true });
const envConfigPath = resolve(ebextensionsDir, 'environment.config');

let envConfigLines = ['option_settings:', '  aws:elasticbeanstalk:application:environment:'];
for (const [key, value] of Object.entries(envVars)) {
  // Escape quotes and special characters for YAML
  const escapedValue = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  envConfigLines.push(`    ${key}: "${escapedValue}"`);
}

writeFileSync(envConfigPath, envConfigLines.join('\n') + '\n');
console.log(`✓ Created environment.config with ${Object.keys(envVars).length} environment variables\n`);

// Step 5: Create deployment package
console.log('📦 Step 5: Creating deployment package...');

// Clean deploy directory
if (existsSync(deployDir)) {
  rmSync(deployDir, { recursive: true });
}
mkdirSync(deployDir, { recursive: true });

// Copy necessary files to deploy directory
// Note: node_modules is excluded - Elastic Beanstalk will run 'npm install --production' automatically
const filesToCopy = [
  'package.json',
  'package-lock.json',
  'dist',
  '.ebextensions', // Elastic Beanstalk configuration
];

console.log('  Copying files to deploy directory...');
for (const file of filesToCopy) {
  const source = resolve(apiDir, file);
  const dest = resolve(deployDir, file);
  
  if (existsSync(source)) {
    if (statSync(source).isDirectory()) {
      cpSync(source, dest, { recursive: true });
    } else {
      cpSync(source, dest);
    }
    console.log(`  ✓ Copied ${file}`);
  } else {
    console.warn(`  ⚠️  ${file} not found, skipping`);
  }
}

// Create zip file
const zipPath = resolve(apiDir, 'deploy.zip');
if (existsSync(zipPath)) {
  rmSync(zipPath);
}

console.log('  Creating zip file...');
const output = createWriteStream(zipPath);
const archive = archiver('zip', { zlib: { level: 9 } });

archive.pipe(output);

// Add files to zip
archive.directory(deployDir, false);

archive.finalize();

output.on('close', () => {
  const sizeMB = (archive.pointer() / 1024 / 1024).toFixed(2);
  console.log(`✓ Deployment package created: deploy.zip (${sizeMB} MB)\n`);
  console.log('✅ Deployment build completed successfully!');
  console.log(`\n📤 Ready to upload deploy.zip to AWS Elastic Beanstalk`);
  console.log(`   The app will start with: npm start`);
  console.log(`   Dependencies will be installed automatically by Elastic Beanstalk`);
  console.log(`   Environment variables are in: .ebextensions/environment.config`);
});

archive.on('error', (err) => {
  console.error('✗ Error creating zip file:', err);
  process.exit(1);
});

