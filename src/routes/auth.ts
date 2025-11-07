// Authentication routes

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../middleware/error.js';
import { strictRateLimiter } from '../middleware/rate-limit.js';
import {
  exchangeCodeForTokens,
  refreshAccessToken,
  signUpUser,
  signInUser,
  createAuthorizationCode,
  updateUserModelPreferences,
} from '../services/auth.js';
import { logger } from '../config/logger.js';
import { config } from '../config/index.js';

const router = Router();

// ============================================================================
// Validation Schemas
// ============================================================================

const tokenExchangeSchema = z.object({
  body: z.object({
    code: z.string().min(1, 'Authorization code is required'),
  }),
});

const tokenRefreshSchema = z.object({
  body: z.object({
    refresh_token: z.string().min(1, 'Refresh token is required'),
  }),
});

const signUpSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    primary_model: z.string().optional(),
    fallback_model: z.string().optional(),
  }),
});

const signInSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
  }),
});

const modelPreferencesSchema = z.object({
  body: z.object({
    primary_model: z.string().optional(),
    fallback_model: z.string().optional().nullable(),
  }),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /auth/config
 * Provide public configuration required by the CLI auth page
 */
router.get(
  '/config',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      supabaseUrl: config.supabaseUrl,
      supabaseAnonKey: config.supabaseAnonKey,
    });
  })
);

/**
 * POST /auth/token
 * Exchange authorization code for access and refresh tokens
 *
 * Request body:
 *   { code: "auth_code_from_cli" }
 *
 * Response:
 *   {
 *     access_token: "jwt_token",
 *     refresh_token: "refresh_token",
 *     expires_in: 3600,
 *     user_email: "user@example.com"
 *   }
 */
router.post(
  '/token',
  strictRateLimiter,
  validate(tokenExchangeSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { code } = req.body;

    logger.info('Token exchange request', { code: code.substring(0, 8) + '...' });

    const tokenResponse = await exchangeCodeForTokens(code);

    res.json(tokenResponse);
  })
);

/**
 * POST /auth/refresh
 * Refresh an expired access token
 *
 * Request body:
 *   { refresh_token: "refresh_token" }
 *
 * Response:
 *   {
 *     access_token: "new_jwt_token",
 *     refresh_token: "new_refresh_token",
 *     expires_in: 3600
 *   }
 */
router.post(
  '/refresh',
  strictRateLimiter,
  validate(tokenRefreshSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { refresh_token } = req.body;

    logger.info('Token refresh request');

    const tokenResponse = await refreshAccessToken(refresh_token);

    res.json(tokenResponse);
  })
);

/**
 * POST /auth/signup
 * Register a new user with email and password
 *
 * Request body:
 *   {
 *     email: "user@example.com",
 *     password: "password123",
 *     primary_model: "claude-3-5-sonnet-20241022" (optional),
 *     fallback_model: "gpt-4" (optional)
 *   }
 *
 * Response:
 *   {
 *     user_id: "uuid",
 *     email: "user@example.com"
 *   }
 */
router.post(
  '/signup',
  strictRateLimiter,
  validate(signUpSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password, primary_model, fallback_model } = req.body;

    logger.info('User signup request', { email });

    const user = await signUpUser(email, password, primary_model, fallback_model);

    res.status(201).json({
      user_id: user.userId,
      email: user.email,
    });
  })
);

/**
 * POST /auth/signin
 * Sign in with email and password
 *
 * Request body:
 *   {
 *     email: "user@example.com",
 *     password: "password123"
 *   }
 *
 * Response:
 *   {
 *     access_token: "jwt_token",
 *     refresh_token: "refresh_token",
 *     expires_in: 3600,
 *     user_id: "uuid",
 *     email: "user@example.com"
 *   }
 */
router.post(
  '/signin',
  strictRateLimiter,
  validate(signInSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body;

    logger.info('User signin request', { email });

    const result = await signInUser(email, password);

    res.json({
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      expires_in: 3600,
      user_id: result.userId,
      email: result.email,
    });
  })
);

/**
 * POST /auth/code
 * Generate authorization code (called from web auth page after login)
 * This endpoint is used internally by the web authentication page
 *
 * Request body:
 *   {
 *     user_id: "uuid",
 *     state: "csrf_token",
 *     primary_model: "claude-3-5-sonnet-20241022" (optional),
 *     fallback_model: "gpt-4" (optional)
 *   }
 *
 * Response:
 *   {
 *     code: "authorization_code",
 *     expires_in: 600
 *   }
 */
router.post(
  '/code',
  asyncHandler(async (req: Request, res: Response) => {
    const { user_id, state, primary_model, fallback_model } = req.body;

    logger.info('Authorization code generation request', { userId: user_id, state });

    // Update model preferences if provided
    if (primary_model || fallback_model !== undefined) {
      await updateUserModelPreferences(user_id, primary_model, fallback_model);
    }

    const code = await createAuthorizationCode(user_id, state);

    res.json({
      code,
      expires_in: 600, // 10 minutes
    });
  })
);

export default router;
