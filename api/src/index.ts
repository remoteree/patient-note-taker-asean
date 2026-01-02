import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import mongoose from 'mongoose';
import authRoutes from './routes/auth';
import consultationRoutes from './routes/consultations';
import patientRoutes from './routes/patients';
import adminRoutes from './routes/admin';
import { setupWebSocketServer } from './ws/server';
import TranscriptionConfig from './models/TranscriptionConfig';

// Load environment variables
const dotenvResult = dotenv.config();
if (dotenvResult.error) {
  console.warn(`Warning: Error loading .env file: ${dotenvResult.error.message}`);
} else if (dotenvResult.parsed) {
  console.log(`✓ Loaded ${Object.keys(dotenvResult.parsed).length} variables from .env file`);
}

// Log environment variable status (without exposing values)
const logEnvVarStatus = (key: string) => {
  const value = process.env[key];
  if (!value) {
    console.warn(`⚠ ${key} is NOT set`);
  }
};

console.log('\n=== Environment Variables Status ===');
logEnvVarStatus('OPENAI_API_KEY');
logEnvVarStatus('DEEPGRAM_API_KEY');
logEnvVarStatus('JWT_SECRET');
logEnvVarStatus('MONGODB_URI');
logEnvVarStatus('ENCRYPTION_KEY');
console.log('====================================\n');

const app = express();
const PORT = parseInt(process.env.PORT || '3002', 10);
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/doc-ai';
const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

// Middleware
// In production, if serving frontend from backend, allow same origin
// Otherwise use CORS_ORIGIN env var or default
const corsOrigin = isProduction && !process.env.CORS_ORIGIN 
  ? true // Allow same origin when serving frontend from backend
  : (process.env.CORS_ORIGIN || (isProduction ? 'https://localhost:5173' : 'http://localhost:5173'));
app.use(cors({
  origin: corsOrigin,
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/consultations', consultationRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/admin', adminRoutes);

// Health check endpoints
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', encryption: 'enabled' });
});

// Serve static files from public directory (for production frontend build)
// In compiled code, __dirname is 'dist', and public is at 'dist/public'
const publicPath = join(__dirname, './public');
console.log(`[STATIC] Looking for public directory at: ${publicPath}`);
console.log(`[STATIC] Public directory exists: ${existsSync(publicPath)}`);
if (existsSync(publicPath)) {
  const indexPath = join(publicPath, 'index.html');
  console.log(`[STATIC] Looking for index.html at: ${indexPath}`);
  console.log(`[STATIC] index.html exists: ${existsSync(indexPath)}`);
  app.use(express.static(publicPath));
  
  // Root route - serve index.html for Elastic Beanstalk health checker
  app.get('/', (req, res) => {
    const indexPath = join(publicPath, 'index.html');
    if (existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.json({ status: 'ok', message: 'API server is running' });
    }
  });
  
  // Handle React Router (SPA) - serve index.html for all non-API routes
  app.get('*', (req, res, next) => {
    // Skip API routes and WebSocket routes
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      return next();
    }
    const indexPath = join(publicPath, 'index.html');
    if (existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      next();
    }
  });
} else {
  console.warn('⚠️  Public directory not found. Frontend will not be served.');
  
  // Fallback root route for health check
  app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'API server is running' });
  });
}

// Create server (HTTP or HTTPS based on environment)
let server;
if (isProduction && process.env.SSL_CERT_PATH && process.env.SSL_KEY_PATH) {
  // Production: Use HTTPS
  try {
    const cert = readFileSync(process.env.SSL_CERT_PATH);
    const key = readFileSync(process.env.SSL_KEY_PATH);
    server = createHttpsServer({ cert, key }, app);
    console.log('HTTPS server configured');
  } catch (error) {
    console.warn('Failed to load SSL certificates, falling back to HTTP:', error);
    server = createHttpServer(app);
  }
} else {
  // Development: Use HTTP (or HTTPS if certificates are provided)
  if (process.env.SSL_CERT_PATH && process.env.SSL_KEY_PATH) {
    try {
      const cert = readFileSync(process.env.SSL_CERT_PATH);
      const key = readFileSync(process.env.SSL_KEY_PATH);
      server = createHttpsServer({ cert, key }, app);
      console.log('HTTPS server configured (development mode)');
    } catch (error) {
      console.warn('Failed to load SSL certificates, using HTTP:', error);
      server = createHttpServer(app);
    }
  } else {
    server = createHttpServer(app);
    if (isProduction) {
      console.warn('WARNING: Running in production without HTTPS. Set SSL_CERT_PATH and SSL_KEY_PATH for encryption in transit.');
    }
  }
}

// Setup WebSocket server
setupWebSocketServer(server);

// Connect to MongoDB with TLS support
const mongooseOptions: mongoose.ConnectOptions = {
  // Enable TLS if MongoDB URI uses mongodb+srv:// or if TLS is explicitly enabled
  tls: MONGODB_URI.includes('mongodb+srv://') || process.env.MONGODB_TLS === 'true',
  tlsAllowInvalidCertificates: process.env.MONGODB_TLS_ALLOW_INVALID === 'true', // Only for development
};

mongoose.connect(MONGODB_URI, mongooseOptions)
  .then(async () => {
    console.log('Connected to MongoDB' + (mongooseOptions.tls ? ' (with TLS)' : ''));
    
    // Initialize transcription config defaults if none exist
    try {
      const configCount = await TranscriptionConfig.countDocuments();
      if (configCount === 0) {
        console.log('[INIT] Initializing default transcription configurations...');
        await TranscriptionConfig.initializeDefaults();
        console.log('[INIT] Default transcription configurations created');
      }
    } catch (error) {
      console.error('[INIT] Error initializing transcription configs:', error);
    }
    
    // Listen on 0.0.0.0 to accept connections from nginx proxy
    server.listen(PORT, '0.0.0.0', () => {
      const protocol = server instanceof createHttpsServer ? 'https' : 'http';
      console.log(`Server running on ${protocol}://0.0.0.0:${PORT}`);
      if (!isProduction && protocol === 'http') {
        console.log('Note: For production, configure HTTPS with SSL_CERT_PATH and SSL_KEY_PATH');
      }
    });
  })
  .catch((error) => {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  });

