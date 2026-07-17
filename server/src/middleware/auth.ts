// Auth middleware — verifies the JWT cookie and attaches userId/tenantId/role.
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { tenantContext } from '../lib/prisma';

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

// Some things are the owner's business only: money (ledger), workspace
// settings, and team management. Agents get a clean 403.
export function requireOwner(req: Request, res: Response, next: NextFunction) {
  if (req.role !== 'OWNER') {
    return res.status(403).json({ error: 'Only the owner can access this' });
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.accessToken;
  if (!token) return res.status(401).json({ error: 'Not logged in' });

  try {
    const payload = jwt.verify(token, config.jwtAccessSecret) as TokenPayload;
    req.userId = payload.userId;
    req.tenantId = payload.tenantId; // <- tenant resolution
    req.role = payload.role;
    // Bind the tenant for the rest of this request so RLS-aware queries scope
    // to it automatically (see lib/prisma.ts). Harmless when RLS is disabled.
    tenantContext.run({ tenantId: payload.tenantId }, () => next());
  } catch {
    return res.status(401).json({ error: 'Session expired' });
  }
}
