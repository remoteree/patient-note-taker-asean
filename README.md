# Doc AI - Medical Note Taker MVP

An AI-powered medical note-taking application for clinics. Doctors can record consultations, get real-time transcripts, and generate structured clinical notes.

## Architecture

- **Backend**: Node.js + TypeScript + Express + WebSocket + MongoDB
- **Frontend**: React + TypeScript + Vite + Material UI
- **Authentication**: JWT with HTTP-only cookies

## Project Structure

```
doc-ai/
├── api/          # Backend server
└── web/          # Frontend application
```

## Prerequisites

- Node.js 18+ and npm
- MongoDB (local or cloud instance)
- Deepgram API key (for speech transcription) - Get one at https://console.deepgram.com/
- OpenAI API key (for note generation) - Get one at https://platform.openai.com/

## Setup Instructions

### Backend Setup

1. Navigate to the backend directory:

```bash
cd api
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file in the `api` directory (copy from `env.example`):

```env
PORT=3001
MONGODB_URI=
JWT_SECRET=your-secret-key-change-in-production
JWT_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost:5173

# Deepgram API Key for speech transcription
# Get your API key from: https://console.deepgram.com/
DEEPGRAM_API_KEY=your-deepgram-api-key-here

# OpenAI API Key for note generation
# Get your API key from: https://platform.openai.com/api-keys
OPENAI_API_KEY=your-openai-api-key-here
```

**Important**: You need to obtain API keys and generate encryption key:

- **Deepgram**: Sign up at https://console.deepgram.com/ and get your API key for speech transcription
- **OpenAI**: Sign up at https://platform.openai.com/ and get your API key for note generation
- **Encryption Key**: Generate a strong encryption key: `openssl rand -base64 32` (required for field-level encryption)

4. Start MongoDB (if running locally):

```bash
# macOS with Homebrew
brew services start mongodb-community

# Or use Docker
docker run -d -p 27017:27017 mongo
```

5. Run the backend in development mode:

```bash
npm run dev
```

The backend will start on `http://localhost:3001`

### Frontend Setup

1. Navigate to the frontend directory:

```bash
cd web
```

2. Install dependencies:

```bash
npm install
```

3. Run the frontend in development mode:

```bash
npm run dev
```

The frontend will start on `http://localhost:5173`

## Usage

1. **Sign Up**: Create a doctor account with email, password, name, specialization, clinic name, and country.

2. **Start Consultation**: Click "New Consultation" on the dashboard.

3. **Record Audio**: Click "Start Recording" to begin capturing audio. The transcript will update in near-real-time.

4. **Stop Recording**: Click "Stop Recording" when done.

5. **Generate Note**: Click "Finish & Generate Note" to generate a structured clinical note from the transcript.

6. **View Details**: Click on any consultation from the dashboard to view the full transcript and generated note.

## Features

- ✅ User authentication (signup/login with JWT)
- ✅ Consultation management
- ✅ Real-time audio streaming via WebSocket
- ✅ **Deepgram** speech transcription (real-time ASR)
- ✅ **OpenAI GPT-4** note generation (structured clinical notes)
- ✅ Clean, modern UI with Material UI

## Development Notes

### AI Services

The application uses real AI integrations:

- **TranscriptionService**: Uses Deepgram's streaming API for real-time speech-to-text transcription
- **NoteService**: Uses OpenAI GPT-4 to generate structured SOAP-format clinical notes from transcripts

### WebSocket Protocol

- **Connection**: `ws://localhost:3001/ws/consultations?consultationId={id}&token={jwt}` (or `wss://` for HTTPS)
- **Messages**: Binary audio chunks sent from client, JSON transcript updates sent from server
- **Message Format**: `{ type: "TRANSCRIPT_UPDATE", consultationId: string, transcript: string }`
- **Security**: Automatically uses WSS (secure WebSocket) when frontend is served over HTTPS

### Environment Variables

**Backend (.env)**:

- `PORT`: Server port (default: 3001)
- `MONGODB_URI`: MongoDB connection string
- `JWT_SECRET`: Secret key for JWT signing
- `JWT_EXPIRES_IN`: JWT expiration time
- `CORS_ORIGIN`: Frontend origin for CORS
- `NODE_ENV`: Environment (development/production)
- `DEEPGRAM_API_KEY`: Deepgram API key for speech transcription (required)
- `OPENAI_API_KEY`: OpenAI API key for note generation (required)
- `ENCRYPTION_KEY`: Encryption key for field-level encryption (required) - Generate with: `openssl rand -base64 32`
- `SSL_CERT_PATH`: Path to SSL certificate file (for HTTPS in production)
- `SSL_KEY_PATH`: Path to SSL private key file (for HTTPS in production)
- `MONGODB_TLS`: Enable TLS for MongoDB connection (set to 'true' for MongoDB Atlas)
- `USE_SECURE_COOKIES`: Use secure cookies (set to 'true' when using HTTPS)

## Security

### Encryption in Transit

- **HTTPS/WSS Support**: The server supports HTTPS and WSS (secure WebSocket) connections
- **TLS Configuration**: Configure SSL certificates via `SSL_CERT_PATH` and `SSL_KEY_PATH` environment variables
- **MongoDB TLS**: MongoDB connections can use TLS (required for MongoDB Atlas)
- **Secure Cookies**: Cookies are marked as secure in production or when `USE_SECURE_COOKIES=true`

### Encryption at Rest

- **Field-Level Encryption**: Sensitive data (transcripts and notes) are encrypted using AES-256-GCM before storage in MongoDB
- **Encryption Key**: Uses `ENCRYPTION_KEY` environment variable (generate with `openssl rand -base64 32`)
- **Automatic Encryption/Decryption**: Data is automatically encrypted on save and decrypted on retrieval
- **Legacy Data Support**: The system can handle unencrypted legacy data gracefully

### Authentication & Authorization

- All routes except `/api/auth/login` and `/api/auth/signup` require authentication
- WebSocket connections are authenticated via JWT token
- Passwords are hashed using bcrypt (10 rounds)
- JWT tokens stored in HTTP-only cookies with secure flags

### Data Privacy

- Audio chunks are processed in-memory only, never persisted to disk or database
- Only transcripts and generated notes are stored (encrypted)
- No audio recordings are saved

## Future Enhancements

- Add audio playback functionality
- Add consultation editing capabilities
- Add export functionality (PDF, DOCX)
- Add search and filtering for consultations
