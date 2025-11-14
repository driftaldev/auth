// Authentication routes

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../middleware/error.js';
import { strictRateLimiter } from '../middleware/rate-limit.js';
import {
  exchangeCodeForTokens,
  refreshAccessToken,
  sendOTP,
  verifyOTP,
  initiateGoogleOAuth,
  handleGoogleCallback,
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

const sendOTPSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
  }),
});

const verifyOTPSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    token: z.string().min(6, 'OTP must be at least 6 characters'),
  }),
});

const googleOAuthCallbackSchema = z.object({
  query: z.object({
    code: z.string().min(1, 'OAuth code is required'),
    state: z.string().optional(),
    callback_port: z.string().optional(),
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
  validate({ body: tokenExchangeSchema.shape.body }),
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
  validate({ body: tokenRefreshSchema.shape.body }),
  asyncHandler(async (req: Request, res: Response) => {
    const { refresh_token } = req.body;

    logger.info('Token refresh request');

    const tokenResponse = await refreshAccessToken(refresh_token);

    res.json(tokenResponse);
  })
);

/**
 * POST /auth/otp/send
 * Send OTP to user's email for passwordless authentication
 *
 * Request body:
 *   {
 *     email: "user@example.com"
 *   }
 *
 * Response:
 *   {
 *     success: true,
 *     message: "OTP sent to your email"
 *   }
 */
router.post(
  '/otp/send',
  strictRateLimiter,
  validate({ body: sendOTPSchema.shape.body }),
  asyncHandler(async (req: Request, res: Response) => {
    const { email } = req.body;

    logger.info('OTP send request', { email });

    const result = await sendOTP(email);

    res.json(result);
  })
);

/**
 * POST /auth/otp/verify
 * Verify OTP and return user information
 *
 * Request body:
 *   {
 *     email: "user@example.com",
 *     token: "123456"
 *   }
 *
 * Response:
 *   {
 *     user_id: "uuid",
 *     email: "user@example.com"
 *   }
 */
router.post(
  '/otp/verify',
  strictRateLimiter,
  validate({ body: verifyOTPSchema.shape.body }),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, token } = req.body;

    logger.info('OTP verify request', { email });

    const result = await verifyOTP(email, token);

    res.json({
      user_id: result.userId,
      email: result.email,
    });
  })
);

/**
 * GET /auth/oauth/google
 * Initiate Google OAuth flow
 *
 * Query params:
 *   redirect_url: URL to redirect back to after OAuth (e.g., http://localhost:3333/callback)
 *
 * Response:
 *   {
 *     url: "https://accounts.google.com/o/oauth2/v2/auth?..."
 *   }
 */
router.get(
  '/oauth/google',
  asyncHandler(async (req: Request, res: Response) => {
    const redirectUrl = req.query.redirect_url as string || `${config.baseUrl}/auth/oauth/google/callback`;

    logger.info('Google OAuth initiation request', { redirectUrl });

    const result = await initiateGoogleOAuth(redirectUrl);

    res.json(result);
  })
);

/**
 * GET /auth/oauth/google/callback
 * Handle Google OAuth callback
 *
 * Query params:
 *   code: OAuth authorization code from Google
 *   state: CSRF token (optional)
 *   callback_port: CLI callback server port (optional, indicates browser redirect)
 *
 * Response:
 *   - If callback_port is present: HTML success page with auto-redirect to CLI
 *   - Otherwise: JSON { user_id, email }
 */
router.get(
  '/oauth/google/callback',
  validate({ query: googleOAuthCallbackSchema.shape.query }),
  asyncHandler(async (req: Request, res: Response) => {
    const { code, state, callback_port } = req.query;

    logger.info('Google OAuth callback received', { hasCallbackPort: !!callback_port });

    const result = await handleGoogleCallback(code as string);

    // If callback_port is present, this is a direct browser redirect from Google
    // Render HTML success page and redirect to CLI callback server
    if (callback_port) {
      try {
        // Generate auth code for CLI
        const authCode = await createAuthorizationCode(
          result.userId,
          (state as string) || 'default'
        );

        // Construct CLI callback URL
        const cliCallbackUrl = `http://127.0.0.1:${callback_port}/callback?code=${authCode}&state=${state || ''}`;

        logger.info('Redirecting to CLI callback server', {
          port: callback_port,
          userId: result.userId
        });

        // Render HTML success page with auto-redirect
        res.setHeader('Content-Type', 'text/html');
        res.send(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <title>Authentication Successful</title>
            </head>
            <body style="font-family: system-ui, -apple-system, sans-serif; text-align: center; padding: 50px; background: #f5f5f5;">
              <h1>Redirecting to CLI callback server...</h1>
              <script>
                // Auto-redirect to CLI callback server after a brief delay
                setTimeout(() => {
                  window.location.href = '${cliCallbackUrl}';
                }, 100);
              </script>
            </body>
          </html>
        `);
      } catch (error) {
        logger.error('Failed to generate auth code for CLI', { error, userId: result.userId });

        // Render error page
        res.setHeader('Content-Type', 'text/html');
        res.status(500).send(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <title>Authentication Error</title>
            </head>
            <body style="font-family: system-ui, -apple-system, sans-serif; text-align: center; padding: 50px; background: #f5f5f5;">
              <h1>Authentication Error</h1>
              <p>Failed to complete authentication. Please try again or contact support.</p>
              <p>You can close this window.</p>
            </body>
          </html>
        `);
      }
    } else {
      // Programmatic call (from auth.html) - return JSON
      res.json({
        user_id: result.userId,
        email: result.email,
      });
    }
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
