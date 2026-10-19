// Deliberately no demo users, passwords, model health, or conversations.
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
await db.$queryRaw`SELECT 1`;
console.log('Database ready. Register your first account through OmniChat.');
await db.$disconnect();
