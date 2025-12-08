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
import { setupWebSocketServer } from './ws/server';

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
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/doc-ai';
const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || (isProduction ? 'https://localhost:5173' : 'http://localhost:5173'),
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/consultations', consultationRoutes);
app.use('/api/patients', patientRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', encryption: 'enabled' });
});

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
  .then(() => {
    console.log('Connected to MongoDB' + (mongooseOptions.tls ? ' (with TLS)' : ''));
    server.listen(PORT, () => {
      const protocol = server instanceof createHttpsServer ? 'https' : 'http';
      console.log(`Server running on ${protocol}://localhost:${PORT}`);
      if (!isProduction && protocol === 'http') {
        console.log('Note: For production, configure HTTPS with SSL_CERT_PATH and SSL_KEY_PATH');
      }
    });
  })
  .catch((error) => {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  });

