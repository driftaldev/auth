// Prisma client initialization for database operations

import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger.js';

// Prisma client singleton
let prismaClient: PrismaClient | null = null;

/**
 * Initialize Prisma client
 * Uses connection pooling and optimized settings for production
 */
export function initializePrisma(): PrismaClient {
  if (prismaClient) {
    return prismaClient;
  }

  try {
    prismaClient = new PrismaClient({
      log: [
        { level: 'query', emit: 'event' },
        { level: 'error', emit: 'event' },
        { level: 'warn', emit: 'event' },
      ],
    });

    // Log queries in development
    if (process.env.NODE_ENV === 'development') {
      prismaClient.$on('query' as never, (e: any) => {
        logger.debug('Prisma Query', {
          query: e.query,
          params: e.params,
          duration: e.duration,
        });
      });
    }

    // Log errors
    prismaClient.$on('error' as never, (e: any) => {
      logger.error('Prisma Error', { error: e });
    });

    // Log warnings
    prismaClient.$on('warn' as never, (e: any) => {
      logger.warn('Prisma Warning', { warning: e });
    });

    logger.info('Prisma client initialized successfully');
    return prismaClient;
  } catch (error) {
    logger.error('Failed to initialize Prisma client', { error });
    throw new Error('Failed to initialize Prisma client');
  }
}

/**
 * Get the initialized Prisma client
 */
export function getPrisma(): PrismaClient {
  if (!prismaClient) {
    return initializePrisma();
  }
  return prismaClient;
}

/**
 * Verify Prisma/database connection
 */
export async function verifyPrismaConnection(): Promise<boolean> {
  try {
    const prisma = getPrisma();

    // Try to query the database
    await prisma.$queryRaw`SELECT 1`;

    logger.info('Prisma connection verified');
    return true;
  } catch (error) {
    logger.error('Prisma connection verification failed', { error });
    return false;
  }
}

/**
 * Disconnect Prisma client (for graceful shutdown)
 */
export async function disconnectPrisma(): Promise<void> {
  if (prismaClient) {
    await prismaClient.$disconnect();
    logger.info('Prisma client disconnected');
    prismaClient = null;
  }
}

// Export singleton
export const prisma = getPrisma();

// Handle graceful shutdown
process.on('beforeExit', async () => {
  await disconnectPrisma();
});
