# Security & Encryption Guide

This document outlines the security features and encryption implementation in Doc AI.

## Encryption Overview

### Encryption in Transit

All data transmitted between client and server can be encrypted using TLS/SSL:

- **HTTPS**: REST API endpoints use HTTPS when SSL certificates are configured
- **WSS**: WebSocket connections automatically use WSS (secure WebSocket) when the frontend is served over HTTPS
- **MongoDB TLS**: Database connections support TLS encryption (required for MongoDB Atlas)

### Encryption at Rest

Sensitive data stored in MongoDB is encrypted using field-level encryption:

- **Algorithm**: AES-256-GCM (authenticated encryption)
- **Encrypted Fields**: Transcripts and clinical notes
- **Automatic**: Encryption/decryption happens automatically via Mongoose hooks

## Setup Instructions

### 1. Generate Encryption Key

Generate a strong encryption key for field-level encryption:

```bash
openssl rand -base64 32
```

Add this to your `.env` file:

```env
ENCRYPTION_KEY=your-generated-key-here
```

**Important**: 
- Store this key securely (use a secrets manager in production)
- Never commit the key to version control
- If you lose this key, encrypted data cannot be decrypted
- Use different keys for different environments (dev/staging/production)

### 2. Configure HTTPS (Production)

#### Option A: Using Let's Encrypt (Recommended)

1. Install Certbot:
```bash
sudo apt-get install certbot  # Ubuntu/Debian
brew install certbot           # macOS
```

2. Obtain certificates:
```bash
sudo certbot certonly --standalone -d yourdomain.com
```

3. Update `.env`:
```env
SSL_CERT_PATH=/etc/letsencrypt/live/yourdomain.com/fullchain.pem
SSL_KEY_PATH=/etc/letsencrypt/live/yourdomain.com/privkey.pem
NODE_ENV=production
USE_SECURE_COOKIES=true
```

#### Option B: Using Self-Signed Certificates (Development/Testing)

1. Generate self-signed certificate:
```bash
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes
```

2. Update `.env`:
```env
SSL_CERT_PATH=./cert.pem
SSL_KEY_PATH=./key.pem
USE_SECURE_COOKIES=true
```

**Note**: Self-signed certificates will show browser warnings. Only use for development/testing.

### 3. Configure MongoDB TLS

#### MongoDB Atlas (Recommended)

MongoDB Atlas uses TLS by default. Use the connection string provided:

```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/doc-ai?retryWrites=true&w=majority
MONGODB_TLS=true
```

#### Self-Managed MongoDB with TLS

1. Enable TLS in MongoDB configuration
2. Update connection string:
```env
MONGODB_URI=mongodb://username:password@host:27017/doc-ai?tls=true
MONGODB_TLS=true
```

## Security Best Practices

### Production Checklist

- [ ] Generate strong `ENCRYPTION_KEY` (32+ bytes, random)
- [ ] Configure HTTPS with valid SSL certificates
- [ ] Set `NODE_ENV=production`
- [ ] Set `USE_SECURE_COOKIES=true`
- [ ] Use MongoDB Atlas or MongoDB with TLS enabled
- [ ] Set `MONGODB_TLS=true` for MongoDB connections
- [ ] Use strong `JWT_SECRET` (different from encryption key)
- [ ] Store all secrets in environment variables or secrets manager
- [ ] Enable MongoDB encryption at rest (if using self-managed MongoDB)
- [ ] Regularly rotate encryption keys (requires data re-encryption)
- [ ] Monitor for security vulnerabilities
- [ ] Use a reverse proxy (nginx/Traefik) for additional security layers

### Key Management

**DO:**
- Store keys in environment variables
- Use secrets management services (AWS Secrets Manager, HashiCorp Vault)
- Rotate keys periodically
- Use different keys for each environment
- Backup keys securely (encrypted backup)

**DON'T:**
- Commit keys to version control
- Share keys via insecure channels
- Use the same key across environments
- Store keys in code or configuration files
- Lose your encryption key (data will be unrecoverable)

## How Encryption Works

### Field-Level Encryption Flow

1. **On Save**: 
   - Mongoose `pre('save')` hook intercepts the document
   - Encrypts `transcript` and `note` fields using AES-256-GCM
   - Stores encrypted data in MongoDB

2. **On Retrieve**:
   - Mongoose `post('find')` hooks intercept queries
   - Decrypts `transcript` and `note` fields automatically
   - Returns decrypted data to application

3. **Legacy Data**:
   - System detects unencrypted data (no `:` separator)
   - Returns data as-is (backward compatible)
   - Next save will encrypt the data

### Encryption Algorithm Details

- **Algorithm**: AES-256-GCM (Galois/Counter Mode)
- **Key Derivation**: PBKDF2 with SHA-256 (100,000 iterations)
- **IV**: 16 bytes (random, stored with ciphertext)
- **Auth Tag**: 16 bytes (for authentication)
- **Format**: `iv:tag:ciphertext` (hex encoded)

## Troubleshooting

### "ENCRYPTION_KEY environment variable is required"

**Solution**: Generate and set the `ENCRYPTION_KEY` in your `.env` file.

### "Failed to decrypt data"

**Possible causes**:
- Wrong encryption key
- Corrupted data
- Legacy unencrypted data (this is handled gracefully)

**Solution**: Verify your `ENCRYPTION_KEY` matches the one used to encrypt the data.

### HTTPS not working

**Check**:
1. SSL certificate files exist and are readable
2. Certificate paths in `.env` are correct
3. Server has permissions to read certificate files
4. Certificate is not expired

### MongoDB TLS connection failed

**Check**:
1. MongoDB server has TLS enabled
2. `MONGODB_TLS=true` is set
3. Connection string is correct
4. Firewall allows TLS connections

## Compliance

This implementation provides:

- **HIPAA**: Encryption in transit and at rest for PHI
- **GDPR**: Encryption of personal data
- **SOC 2**: Security controls for data protection

**Note**: Additional compliance requirements may apply based on your jurisdiction and use case. Consult with legal/compliance teams.

## Support

For security issues or questions:
1. Review this documentation
2. Check environment variables
3. Review server logs for encryption errors
4. Contact your security team









