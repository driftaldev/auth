// Health check routes

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { verifySupabaseConnection } from '../services/supabase.js';
import { verifyRedisConnection } from '../middleware/rate-limit.js';
import { logger } from '../config/logger.js';
import { HealthCheckResponse } from '../types/index.js';

const router = Router();

/**
 * GET /health
 * Health check endpoint
 *
 * Response:
 *   {
 *     status: "ok" | "degraded" | "error",
 *     supabase: "connected" | "disconnected",
 *     redis: "connected" | "disconnected",
 *     timestamp: "2025-01-04T12:00:00Z",
 *     version: "1.0.0"
 *   }
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    logger.debug('Health check request');

    // Check Supabase connection
    const supabaseConnected = await verifySupabaseConnection();

    // Check Redis connection
    const redisConnected = await verifyRedisConnection();

    // Determine overall status
    let status: 'ok' | 'degraded' | 'error';
    if (supabaseConnected && redisConnected) {
      status = 'ok';
    } else if (supabaseConnected || redisConnected) {
      status = 'degraded';
    } else {
      status = 'error';
    }

    const response: HealthCheckResponse = {
      status,
      supabase: supabaseConnected ? 'connected' : 'disconnected',
      redis: redisConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
    };

    // Set appropriate HTTP status code
    const httpStatus = status === 'ok' ? 200 : status === 'degraded' ? 200 : 503;

    res.status(httpStatus).json(response);
  })
);

/**
 * GET /health/ready
 * Readiness probe for Kubernetes/Docker
 */
router.get(
  '/ready',
  asyncHandler(async (req: Request, res: Response) => {
    const supabaseConnected = await verifySupabaseConnection();

    if (supabaseConnected) {
      res.status(200).json({ ready: true });
    } else {
      res.status(503).json({ ready: false });
    }
  })
);

/**
 * GET /health/live
 * Liveness probe for Kubernetes/Docker
 */
router.get('/live', (req: Request, res: Response) => {
  res.status(200).json({ alive: true });
});

export default router;
