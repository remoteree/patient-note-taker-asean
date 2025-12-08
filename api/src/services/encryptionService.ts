import crypto from 'crypto';

/**
 * Encryption service for field-level encryption of sensitive data
 * Uses AES-256-GCM for authenticated encryption
 */
class EncryptionService {
  private algorithm = 'aes-256-gcm';
  private keyLength = 32; // 256 bits
  private ivLength = 16; // 128 bits
  private saltLength = 64;
  private tagLength = 16;
  private iterations = 100000;

  private getEncryptionKey(): Buffer {
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new Error('ENCRYPTION_KEY environment variable is required');
    }

    // Derive a consistent key from the environment variable
    return crypto.pbkdf2Sync(
      encryptionKey,
      'doc-ai-salt',
      this.iterations,
      this.keyLength,
      'sha256'
    );
  }

  /**
   * Encrypts a string value
   */
  encrypt(text: string): string {
    if (!text) {
      return text;
    }

    try {
      const key = this.getEncryptionKey();
      const iv = crypto.randomBytes(this.ivLength);
      const cipher = crypto.createCipheriv(this.algorithm, key, iv);

      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const tag = cipher.getAuthTag();

      // Combine IV + tag + encrypted data
      const combined = iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;

      return combined;
    } catch (error) {
      console.error('Encryption error:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  /**
   * Decrypts an encrypted string value
   */
  decrypt(encryptedText: string): string {
    if (!encryptedText) {
      return encryptedText;
    }

    // Check if the text is already encrypted (has the format iv:tag:data)
    if (!encryptedText.includes(':')) {
      // Legacy unencrypted data - return as is
      return encryptedText;
    }

    try {
      const parts = encryptedText.split(':');
      if (parts.length !== 3) {
        // Invalid format - might be legacy data
        return encryptedText;
      }

      const [ivHex, tagHex, encrypted] = parts;
      const iv = Buffer.from(ivHex, 'hex');
      const tag = Buffer.from(tagHex, 'hex');
      const key = this.getEncryptionKey();

      const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
      decipher.setAuthTag(tag);

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      console.error('Decryption error:', error);
      // If decryption fails, return the original (might be legacy unencrypted data)
      return encryptedText;
    }
  }

  /**
   * Encrypts an object's sensitive fields
   */
  encryptFields<T extends Record<string, any>>(
    obj: T,
    fieldsToEncrypt: (keyof T)[]
  ): T {
    const encrypted = { ...obj };
    for (const field of fieldsToEncrypt) {
      if (encrypted[field] && typeof encrypted[field] === 'string') {
        encrypted[field] = this.encrypt(encrypted[field]) as any;
      }
    }
    return encrypted;
  }

  /**
   * Decrypts an object's sensitive fields
   */
  decryptFields<T extends Record<string, any>>(
    obj: T,
    fieldsToDecrypt: (keyof T)[]
  ): T {
    const decrypted = { ...obj };
    for (const field of fieldsToDecrypt) {
      if (decrypted[field] && typeof decrypted[field] === 'string') {
        decrypted[field] = this.decrypt(decrypted[field]) as any;
      }
    }
    return decrypted;
  }
}

export const encryptionService = new EncryptionService();



