// Phase 0: All environment config in one place. Values come from .env — never hard-coded.
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: Number(process.env.PORT) || 4000,
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
  accessTokenTtl: '15m',   // short-lived access token
  refreshTokenTtl: '7d',   // long-lived refresh token

  // FastAPI AI service. When set, parsing + risk scoring use it (with the
  // built-in TypeScript rules as automatic fallback if it's unreachable).
  aiServiceUrl: process.env.AI_SERVICE_URL || '',

  // Set COOKIE_SECURE=true when client & API are on different HTTPS domains
  cookieSecure: process.env.COOKIE_SECURE === 'true',
};
