// Phase 1: Simple in-memory rate limiter for auth endpoints.
// (The guide suggests Redis; in-memory keeps the demo dependency-free.
// Swap the Map for Redis INCR when you scale to multiple servers.)
import { Request, Response, NextFunction } from 'express';

const hits = new Map<string, { count: number; resetAt: number }>();

// Allow `max` requests per `windowMs` per IP.
export function rateLimit(max: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count++;
    if (entry.count > max) {
      return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    }
    next();
  };
}
