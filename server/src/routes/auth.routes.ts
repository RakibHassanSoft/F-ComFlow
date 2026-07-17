// Auth — register, login, refresh, logout. bcrypt + JWT in httpOnly cookies.
import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { requireAuth, TokenPayload } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';

const router = Router();

// Helper: create both tokens and set them as httpOnly cookies.
// COOKIE_SECURE=true switches to secure/none for cross-domain HTTPS deploys.
function setAuthCookies(res: any, payload: TokenPayload) {
  const accessToken = jwt.sign(payload, config.jwtAccessSecret, { expiresIn: '15m' });
  const refreshToken = jwt.sign(payload, config.jwtRefreshSecret, { expiresIn: '7d' });

  const cookieOptions = {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSecure ? ('none' as const) : ('lax' as const),
  };
  res.cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
  res.cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });
  return accessToken;
}

// POST /api/auth/register — creates a NEW tenant + its owner user
router.post('/register', rateLimit(10, 60_000), async (req, res, next) => {
  try {
    const { businessName, name, email, password } = req.body;
    if (!businessName || !name || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    // Create tenant and owner together
    const tenant = await prisma.tenant.create({
      data: {
        businessName,
        users: {
          create: { name, email, passwordHash: await bcrypt.hash(password, 10), role: 'OWNER' },
        },
      },
      include: { users: true },
    });

    const user = tenant.users[0];
    const token = setAuthCookies(res, { userId: user.id, tenantId: tenant.id, role: user.role });
    res.status(201).json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      tenant: { id: tenant.id, businessName: tenant.businessName },
      token, // used by the client for the Socket.io handshake
    });
  } catch (err) { next(err); }
});

// POST /api/auth/login — rate-limited: 5 attempts per minute per IP
router.post('/login', rateLimit(5, 60_000), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email }, include: { tenant: true } });

    // Same error for "no user" and "wrong password" — don't leak which emails exist
    if (!user || !(await bcrypt.compare(password || '', user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    console.log(`[audit] login: ${user.email} (tenant ${user.tenantId})`); // Phase 1: audit logging
    const token = setAuthCookies(res, { userId: user.id, tenantId: user.tenantId, role: user.role });
    res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      tenant: { id: user.tenant.id, businessName: user.tenant.businessName },
      token,
    });
  } catch (err) { next(err); }
});

// POST /api/auth/refresh — rotates tokens so sessions survive past 15 minutes
router.post('/refresh', async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (!token) return res.status(401).json({ error: 'No refresh token' });
  try {
    const { userId, tenantId, role } = jwt.verify(token, config.jwtRefreshSecret) as TokenPayload;
    const newToken = setAuthCookies(res, { userId, tenantId, role }); // rotation: fresh pair issued
    res.json({ ok: true, token: newToken });
  } catch {
    res.status(401).json({ error: 'Refresh token expired' });
  }
});

// POST /api/auth/logout — clears both cookies
router.post('/logout', (_req, res) => {
  res.clearCookie('accessToken');
  res.clearCookie('refreshToken');
  res.json({ ok: true });
});

// GET /api/auth/me — who am I? (used on page load to restore the session)
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findFirst({
      where: { id: req.userId, tenantId: req.tenantId }, // tenant-scoped, like every query
      include: { tenant: true },
    });
    if (!user) return res.status(401).json({ error: 'User not found' });
    res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      tenant: { id: user.tenant.id, businessName: user.tenant.businessName, riskThreshold: user.tenant.riskThreshold },
    });
  } catch (err) { next(err); }
});

// POST /api/auth/google — "Sign in with Google".
// The client sends the ID token (credential) from Google Identity Services;
// we verify it against Google's tokeninfo endpoint (no extra dependency),
// then log the user in — creating a fresh store on their first visit.
router.post('/google', rateLimit(10, 60_000), async (req, res, next) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Missing Google credential' });
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(422).json({ error: 'Google login is not configured on this server' });
    }

    // Verify the token with Google (checks signature + expiry server-side)
    const verify = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
      { signal: AbortSignal.timeout(8_000) }
    );
    if (!verify.ok) return res.status(401).json({ error: 'Google token is invalid or expired' });
    const info: any = await verify.json();

    // The token must have been issued for OUR app, to a verified email
    if (info.aud !== process.env.GOOGLE_CLIENT_ID) {
      return res.status(401).json({ error: 'Google token was issued for a different app' });
    }
    if (info.email_verified !== 'true' && info.email_verified !== true) {
      return res.status(401).json({ error: 'Google account email is not verified' });
    }

    const email = String(info.email).toLowerCase();
    const name = info.name || info.given_name || email.split('@')[0];

    // Existing user -> log in. New user -> create their store (like /register).
    let user = await prisma.user.findUnique({ where: { email }, include: { tenant: true } });
    if (!user) {
      const tenant = await prisma.tenant.create({
        data: {
          businessName: `${info.given_name || name}'s Shop`,
          users: {
            create: {
              name,
              email,
              // No password for Google accounts — store an unusable random hash
              passwordHash: await bcrypt.hash(crypto.randomUUID() + Date.now(), 10),
              role: 'OWNER',
            },
          },
        },
        include: { users: { include: { tenant: true } } },
      });
      user = { ...tenant.users[0], tenant };
      console.log(`[audit] google signup: ${email} (new tenant ${tenant.id})`);
    } else {
      console.log(`[audit] google login: ${email} (tenant ${user.tenantId})`);
    }

    const token = setAuthCookies(res, { userId: user.id, tenantId: user.tenantId, role: user.role });
    res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      tenant: { id: user.tenant.id, businessName: user.tenant.businessName },
      token,
    });
  } catch (err) { next(err); }
});

// ---------- Team management (OWNER only) ----------

function requireOwner(req: any, res: any, next: any) {
  if (req.role !== 'OWNER') return res.status(403).json({ error: 'Only the owner can manage the team' });
  next();
}

// GET /api/auth/users — everyone in this workspace
router.get('/users', requireAuth, requireOwner, async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { tenantId: req.tenantId },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json(users);
  } catch (err) { next(err); }
});

// POST /api/auth/users — invite an agent (they log in with this email/password)
router.post('/users', requireAuth, requireOwner, async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const user = await prisma.user.create({
      data: {
        tenantId: req.tenantId,
        name,
        email,
        passwordHash: await bcrypt.hash(password, 10),
        role: 'AGENT',
      },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });
    res.status(201).json(user);
  } catch (err) { next(err); }
});

// DELETE /api/auth/users/:id — remove an agent (never yourself, never an owner)
router.delete('/users/:id', requireAuth, requireOwner, async (req, res, next) => {
  try {
    if (req.params.id === req.userId) {
      return res.status(422).json({ error: 'You cannot remove yourself' });
    }
    const user = await prisma.user.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'OWNER') return res.status(422).json({ error: 'Owners cannot be removed' });

    // Release any conversations assigned to them so threads never get stuck
    await prisma.conversation.updateMany({
      where: { tenantId: req.tenantId, assignedTo: user.id },
      data: { assignedTo: null },
    });
    await prisma.user.delete({ where: { id: user.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
