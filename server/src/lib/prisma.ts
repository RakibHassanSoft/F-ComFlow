// One shared Prisma client for the whole app.
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
