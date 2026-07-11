// Phase 1: Authentication middleware.
// Runs on every protected route: verifies the JWT from the httpOnly cookie,
// then attaches userId / tenantId / role to the request.
// EVERY database query after this point is scoped by req.tenantId —
// that is the tenant-isolation rule from the implementation guide.
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

// Add our custom fields to Express's Request type
declare global {
  namespace Express {
    interface Request {
      userId: string;
      tenantId: string;
      role: string;
    }
  }
}

export interface TokenPayload {
  userId: string;
  tenantId: string;
  role: string;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.accessToken;
  if (!token) return res.status(401).json({ error: 'Not logged in' });

  try {
    const payload = jwt.verify(token, config.jwtAccessSecret) as TokenPayload;
    req.userId = payload.userId;
    req.tenantId = payload.tenantId; // <- tenant resolution
    req.role = payload.role;
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired' });
  }
}
