// Rate limiting middleware using Upstash Redis

import { Request, Response, NextFunction } from 'express';
import { Redis } from '@upstash/redis';
import { config } from '../config/index.js';
import { RateLimitError } from '../types/index.js';
import { logger } from '../config/logger.js';

// Initialize Upstash Redis client
let redis: Redis | null = null;

function getRedisClient(): Redis {
  if (!redis) {
    redis = new Redis({
      url: config.redisUrl,
      token: config.redisToken,
    });
    logger.info('Upstash Redis client initialized');
  }
  return redis;
}

/**
 * Token bucket rate limiting algorithm
 * Allows burst traffic while maintaining average rate limit
 */
interface RateLimitOptions {
  windowMs?: number; // Time window in milliseconds
  maxRequests?: number; // Maximum requests per window
  keyPrefix?: string; // Prefix for Redis keys
  skipSuccessfulRequests?: boolean; // Don't count successful requests
  skipFailedRequests?: boolean; // Don't count failed requests
  handler?: (req: Request, res: Response) => void; // Custom handler when limit exceeded
}

export function rateLimiter(options: RateLimitOptions = {}) {
  const {
    windowMs = config.rateLimitWindowMs,
    maxRequests = config.rateLimitMaxRequests,
    keyPrefix = 'ratelimit',
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    handler,
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const redis = getRedisClient();

      // Get user identifier (userId if authenticated, IP if not)
      const identifier = req.userId || req.ip || 'anonymous';
      const key = `${keyPrefix}:${identifier}`;

      // Get current count
      const current = await redis.get<number>(key);
      const count = current || 0;

      // Check if limit exceeded
      if (count >= maxRequests) {
        // Get TTL to calculate retry-after
        const ttl = await redis.ttl(key);
        const retryAfter = Math.ceil(ttl / 1000); // Convert to seconds

        logger.warn('Rate limit exceeded', {
          identifier,
          count,
          maxRequests,
          retryAfter,
        });

        if (handler) {
          handler(req, res);
        } else {
          res.status(429).json({
            error: 'Too many requests',
            code: 'RATE_LIMIT_ERROR',
            retryAfter,
            limit: maxRequests,
            window: windowMs / 1000, // Convert to seconds
          });
        }
        return;
      }

      // Increment counter
      const newCount = await redis.incr(key);

      // Set expiry on first request
      if (newCount === 1) {
        await redis.expire(key, Math.ceil(windowMs / 1000));
      }

      // Add rate limit headers
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - newCount));
      res.setHeader('X-RateLimit-Reset', Date.now() + windowMs);

      // Store original send function
      if (!skipSuccessfulRequests || !skipFailedRequests) {
        const originalSend = res.send;
        res.send = function (data) {
          // Check if we should decrement the counter
          const shouldSkip =
            (skipSuccessfulRequests && res.statusCode < 400) ||
            (skipFailedRequests && res.statusCode >= 400);

          if (shouldSkip) {
            redis.decr(key).catch((err) => {
              logger.error('Failed to decrement rate limit counter', { err });
            });
          }

          return originalSend.call(this, data);
        } as typeof res.send;
      }

      next();
    } catch (error) {
      logger.error('Rate limit middleware error', { error });
      // Don't block requests if rate limiting fails
      next();
    }
  };
}

/**
 * Strict rate limiter for sensitive endpoints (auth, etc.)
 */
export const strictRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5, // 5 requests per 15 minutes
  keyPrefix: 'ratelimit:strict',
});

/**
 * Standard rate limiter for API endpoints
 */
export const apiRateLimiter = rateLimiter({
  windowMs: config.rateLimitWindowMs,
  maxRequests: config.rateLimitMaxRequests,
  keyPrefix: 'ratelimit:api',
});

/**
 * LLM proxy rate limiter (more generous for paid requests)
 */
export const llmRateLimiter = rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 30, // 30 requests per minute
  keyPrefix: 'ratelimit:llm',
  skipFailedRequests: true, // Don't count failed requests
});

/**
 * Global rate limiter (applies to all requests)
 */
export const globalRateLimiter = rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100, // 100 requests per minute per IP
  keyPrefix: 'ratelimit:global',
});

/**
 * Verify Redis connection
 */
export async function verifyRedisConnection(): Promise<boolean> {
  try {
    const redis = getRedisClient();
    await redis.ping();
    logger.info('Redis connection verified');
    return true;
  } catch (error) {
    logger.error('Redis connection verification failed', { error });
    return false;
  }
}

export { getRedisClient };
