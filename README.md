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
- Deepgram API key (for cloud mode speech transcription) - Get one at https://console.deepgram.com/
- OpenAI API key (for note generation) - Get one at https://platform.openai.com/
- Python 3.8+ and pip (for local mode transcription with faster-whisper)

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

5. Install Python dependencies for local mode transcription (optional):

```bash
# Install faster-whisper for general transcription
pip install faster-whisper

# Install BanglaSpeech2Text for Bengali transcription (recommended for Bengali)
pip install banglaspeech2text

# Or if you prefer using a virtual environment:
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install faster-whisper banglaspeech2text
```

**Note**:

- Local mode is optional. If you only want to use cloud mode (Deepgram/ElevenLabs), you can skip this step.
- For Bengali transcription, **BanglaSpeech2Text** is recommended as it's fine-tuned specifically for Bangla language and provides better accuracy (WER: 11-46% depending on model size).
- BanglaSpeech2Text models: `tiny` (100-200MB, WER 74%), `base` (200-300MB, WER 46%), `small` (1GB, WER 18%), `large` (3-4GB, WER 11%)

6. Run the backend in development mode:

```bash
npm run dev
```

The backend will start on `http://localhost:3002`

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

### Creating an Admin User

To create an admin user who can access the admin dashboard for managing transcription configurations:

**Option 1: Interactive Mode** (recommended for first-time setup)

```bash
cd api
npm run create-admin
```

The script will prompt you for:

- Email
- Password (input will be hidden)
- Name
- Specialization
- Clinic Name
- Country

**Option 2: Command Line Arguments**

```bash
cd api
npm run create-admin -- --email=admin@example.com --password=yourpassword --name="Admin User" --specialization="General" --clinicName="Admin Clinic" --country="US"
```

**Note**:

- If a user with the provided email already exists, they will be promoted to admin role
- The script connects to MongoDB using the `MONGODB_URI` from your `.env` file
- Admin users will see an "Admin" button in the navigation bar that takes them to the transcription configuration dashboard

## Usage

1. **Sign Up**: Create a doctor account with email, password, name, specialization, clinic name, and country.

2. **Start Consultation**: Click "New Consultation" on the dashboard.

3. **Choose Transcription Mode**:

   - **Cloud Mode** (default): Real-time transcription using Deepgram API. Requires internet connection.
   - **Local Mode**: Offline transcription using faster-whisper. Processes audio after recording completes. May have lower accuracy and higher resource usage.

4. **Record Audio**: Click "Start Recording" to begin capturing audio.

   - **Cloud Mode**: Transcript updates in near-real-time as you speak.
   - **Local Mode**: Audio is recorded locally. Select language (Thai, Bengali, English, Malay, or Auto-detect) before recording.

5. **Stop Recording**: Click "Stop Recording" when done.

6. **Generate Note**: Click "Finish & Generate Note" to generate a structured clinical note from the transcript.

   - **Local Mode**: Audio will be transcribed first, then notes will be generated.

7. **View Details**: Click on any consultation from the dashboard to view the full transcript and generated note.

## Features

- ✅ User authentication (signup/login with JWT)
- ✅ **Admin Dashboard** for managing transcription configurations
- ✅ Role-based access control (admin/user roles)
- ✅ Consultation management
- ✅ **Dual Transcription Modes**:
  - **Cloud Mode**: Real-time transcription via Deepgram API (requires internet)
  - **Local Mode**: Offline transcription using faster-whisper (processes after recording)
- ✅ Real-time audio streaming via WebSocket (cloud mode)
- ✅ **Deepgram** speech transcription (cloud mode, real-time ASR)
- ✅ **faster-whisper** local transcription (local mode, supports Thai, Bengali, English, Malay)
- ✅ **BanglaSpeech2Text** local transcription (local mode, optimized for Bengali/Bangla)
- ✅ **OpenAI GPT-4** note generation (structured clinical notes)
- ✅ Clean, modern UI with Material UI

## Development Notes

### AI Services

The application uses real AI integrations:

- **TranscriptionService (Cloud Mode)**: Uses Deepgram's streaming API for real-time speech-to-text transcription
- **LocalTranscriptionService (Local Mode)**: Supports multiple local transcription providers:
  - **faster-whisper**: General-purpose offline transcription with chunked processing
    - Supports multiple languages: Thai, Bengali, English, Malay, or auto-detect
    - Uses VAD (Voice Activity Detection) filtering
    - Configurable chunk length (default: 30 seconds) and beam size (default: 5)
  - **BanglaSpeech2Text**: Specialized Bengali/Bangla transcription (recommended for Bengali)
    - Fine-tuned Whisper models optimized for Bangla language
    - Better accuracy than general-purpose models for Bengali
    - Model options: tiny, base, small, large (larger = better accuracy, slower inference)
- **NoteService**: Uses OpenAI GPT-4 to generate structured SOAP-format clinical notes from transcripts

### WebSocket Protocol

- **Connection**: `ws://localhost:3002/ws/consultations?consultationId={id}&token={jwt}` (or `wss://` for HTTPS)
- **Messages**: Binary audio chunks sent from client, JSON transcript updates sent from server
- **Message Format**: `{ type: "TRANSCRIPT_UPDATE", consultationId: string, transcript: string }`
- **Security**: Automatically uses WSS (secure WebSocket) when frontend is served over HTTPS

### Environment Variables

**Backend (.env)**:

- `PORT`: Server port (default: 3002)
- `MONGODB_URI`: MongoDB connection string
- `JWT_SECRET`: Secret key for JWT signing
- `JWT_EXPIRES_IN`: JWT expiration time
- `CORS_ORIGIN`: Frontend origin for CORS
- `NODE_ENV`: Environment (development/production)
- `DEEPGRAM_API_KEY`: Deepgram API key for cloud mode speech transcription (required for cloud mode)
- `ELEVENLABS_API_KEY`: ElevenLabs API key for batch transcription (required for ElevenLabs provider)
- `AWS_ACCESS_KEY_ID`: AWS access key ID (required for AWS Transcribe)
- `AWS_SECRET_ACCESS_KEY`: AWS secret access key (required for AWS Transcribe)
- `AWS_REGION`: AWS region (default: us-east-1)
- `AWS_TRANSCRIBE_S3_BUCKET`: S3 bucket name for storing audio files for transcription (required for AWS Transcribe)
- `OPENAI_API_KEY`: OpenAI API key for note generation (required)
- `ENCRYPTION_KEY`: Encryption key for field-level encryption (required) - Generate with: `openssl rand -base64 32`
- `SSL_CERT_PATH`: Path to SSL certificate file (for HTTPS in production)
- `SSL_KEY_PATH`: Path to SSL private key file (for HTTPS in production)
- `MONGODB_TLS`: Enable TLS for MongoDB connection (set to 'true' for MongoDB Atlas)
- `USE_SECURE_COOKIES`: Use secure cookies (set to 'true' when using HTTPS)
- `WHISPER_MODEL_PATH`: faster-whisper model path or name (default: 'base') - Options: tiny, base, small, medium, large-v2, large-v3
- `WHISPER_DEVICE`: Device for faster-whisper (default: 'cpu') - Options: 'cpu' or 'cuda'
- `WHISPER_COMPUTE_TYPE`: Compute type for faster-whisper (default: 'int8') - Options: 'int8', 'int16', 'float16', 'float32'
- `PYTHON_PATH`: Path to Python executable (default: 'python3')
- `BANGLA_MODEL`: BanglaSpeech2Text model size (default: 'base') - Options: tiny, base, small, large (configured via admin dashboard config.model)

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

### AWS Transcribe IAM Permissions

When using AWS Transcribe, your IAM user/role needs the following permissions:

**Required Permissions:**

- `transcribe:StartTranscriptionJob` - Start transcription jobs
- `transcribe:GetTranscriptionJob` - Check job status and retrieve results
- `s3:PutObject` - Upload audio files to S3
- `s3:GetObject` - Read transcription results from S3
- `s3:DeleteObject` - Clean up temporary files

**Quick Setup:**

1. Attach the managed policy `AmazonTranscribeFullAccess` to your IAM user, OR
2. Create a custom policy with the above permissions

**Example Custom Policy:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "transcribe:StartTranscriptionJob",
        "transcribe:GetTranscriptionJob"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
    }
  ]
}
```

**Note:** If you see `AccessDeniedException` errors, check that your IAM user has the `transcribe:StartTranscriptionJob` permission.

## Future Enhancements

- Add audio playback functionality
- Add consultation editing capabilities
- Add export functionality (PDF, DOCX)
- Add search and filtering for consultations
