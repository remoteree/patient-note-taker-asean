import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/jwt';

export interface AuthRequest extends Request {
  userId?: string;
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  // Log authentication attempt
  console.log(`\n[Auth Middleware] ${req.method} ${req.path}`);
  console.log(`[Auth Middleware] Authorization header: ${req.headers.authorization ? 'present' : 'missing'}`);
  console.log(`[Auth Middleware] JWT_SECRET length: ${JWT_SECRET.length}`);
  console.log(`[Auth Middleware] JWT_SECRET starts with: ${JWT_SECRET.substring(0, 4)}...`);
  
  // Check Authorization header first (Bearer token)
  const authHeader = req.headers.authorization;
  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
    console.log(`[Auth Middleware] Token extracted from Authorization header (length: ${token.length})`);
    console.log(`[Auth Middleware] Token preview: ${token.substring(0, 20)}...${token.substring(token.length - 20)}`);
  } else {
    // Fallback to cookie for backward compatibility
    token = req.cookies.token;
    if (token) {
      console.log(`[Auth Middleware] Token extracted from cookie (length: ${token.length})`);
    }
  }

  if (!token) {
    console.log(`[Auth Middleware] ✗ No token found`);
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    // Decode without verification first to see what's in the token
    const decodedWithoutVerify = jwt.decode(token) as { userId?: string; iat?: number; exp?: number } | null;
    if (decodedWithoutVerify) {
      console.log(`[Auth Middleware] Token payload: userId=${decodedWithoutVerify.userId}, iat=${decodedWithoutVerify.iat}, exp=${decodedWithoutVerify.exp}`);
      const now = Math.floor(Date.now() / 1000);
      if (decodedWithoutVerify.exp && decodedWithoutVerify.exp < now) {
        console.log(`[Auth Middleware] ✗ Token expired (exp: ${decodedWithoutVerify.exp}, now: ${now})`);
        return res.status(401).json({ error: 'Token expired' });
      }
    } else {
      console.log(`[Auth Middleware] ✗ Token could not be decoded`);
    }

    // Compare current JWT_SECRET with process.env to ensure they match
    const envSecret = process.env.JWT_SECRET || 'secret';
    console.log(`[Auth Middleware] Comparing secrets - Config: ${JWT_SECRET.substring(0, 8)}... (len: ${JWT_SECRET.length}), Env: ${envSecret.substring(0, 8)}... (len: ${envSecret.length})`);
    console.log(`[Auth Middleware] Secrets match: ${JWT_SECRET === envSecret}`);

    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    console.log(`[Auth Middleware] ✓ Token verified successfully, userId: ${decoded.userId}`);
    req.userId = decoded.userId;
    next();
  } catch (error: any) {
    console.error(`[Auth Middleware] ✗ Token verification failed:`, error.message);
    console.error(`[Auth Middleware] Error name: ${error.name}`);
    if (error.name === 'JsonWebTokenError') {
      console.error(`[Auth Middleware] JWT Error - This usually means the secret doesn't match`);
      // Try to verify with process.env directly to see if that works
      const envSecret = process.env.JWT_SECRET || 'secret';
      console.error(`[Auth Middleware] Attempting verification with process.env.JWT_SECRET directly...`);
      try {
        jwt.verify(token, envSecret);
        console.error(`[Auth Middleware] ⚠ Verification with process.env.JWT_SECRET succeeded! This means there's a mismatch between config and process.env`);
      } catch (e: any) {
        console.error(`[Auth Middleware] Verification with process.env.JWT_SECRET also failed: ${e.message}`);
      }
    } else if (error.name === 'TokenExpiredError') {
      console.error(`[Auth Middleware] Token expired at: ${error.expiredAt}`);
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};



