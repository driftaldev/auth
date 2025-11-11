// Authentication service with OAuth logic
// Uses Prisma ORM for database operations

import { randomBytes } from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { supabase } from './supabase.js';
import { config } from '../config/index.js';
import { logger, logAuthentication } from '../config/logger.js';
import {
  AuthenticationError,
  ValidationError,
  TokenExchangeResponse,
  TokenRefreshResponse,
} from '../types/index.js';

/**
 * Generate a random authorization code
 */
export function generateAuthCode(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Generate authorization code and store in database using Prisma
 * Called from the web authentication page after successful login
 */
export async function createAuthorizationCode(
  userId: string,
  state: string
): Promise<string> {
  try {
    const code = generateAuthCode();
    const expiresAt = new Date(
      Date.now() + config.authCodeExpiryMinutes * 60 * 1000
    );

    // Store auth code in database using Prisma
    await prisma.authCode.create({
      data: {
        code,
        userId,
        state,
        expiresAt,
        used: false,
      },
    });

    logger.info('Authorization code created', { userId, state });
    return code;
  } catch (error) {
    logger.error('Error creating authorization code', { error, userId });
    throw error;
  }
}

/**
 * Validate and consume authorization code using Prisma
 * Returns user ID if valid, throws error if invalid
 */
export async function validateAuthorizationCode(
  code: string
): Promise<{ userId: string; state: string }> {
  try {
    // Fetch auth code from database using Prisma
    const authCode = await prisma.authCode.findUnique({
      where: { code },
    });

    if (!authCode) {
      logger.warn('Invalid authorization code', { code: code.substring(0, 8) + '...' });
      throw new AuthenticationError('Invalid authorization code');
    }

    // Check if already used
    if (authCode.used) {
      logger.warn('Authorization code already used', { code: code.substring(0, 8) + '...' });
      throw new AuthenticationError('Authorization code has already been used');
    }

    // Check if expired
    if (authCode.expiresAt < new Date()) {
      logger.warn('Authorization code expired', { code: code.substring(0, 8) + '...' });
      throw new AuthenticationError('Authorization code has expired');
    }

    // Mark as used using Prisma
    await prisma.authCode.update({
      where: { code },
      data: {
        used: true,
        usedAt: new Date(),
      },
    });

    logger.info('Authorization code validated', { userId: authCode.userId });

    return {
      userId: authCode.userId,
      state: authCode.state,
    };
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw error;
    }
    logger.error('Error validating authorization code', { error });
    throw new AuthenticationError('Failed to validate authorization code');
  }
}

/**
 * Exchange authorization code for access and refresh tokens
 * This creates a new Supabase session for the user
 */
export async function exchangeCodeForTokens(
  code: string
): Promise<TokenExchangeResponse> {
  try {
    // Validate the authorization code using Prisma
    const { userId } = await validateAuthorizationCode(code);

    // Get user from Supabase auth
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.admin.getUserById(userId);

    if (userError || !user) {
      logger.error('Failed to get user', { error: userError, userId });
      throw new AuthenticationError('User not found');
    }

    // Create a new session for the user using admin API
    // This generates new access and refresh tokens
    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: user.email!,
    });

    if (error) {
      logger.error('Failed to generate session tokens', { error, userId });
      throw new AuthenticationError('Failed to generate tokens');
    }

    // Get or create user profile using Prisma
    const profile = await prisma.userProfile.findUnique({
      where: { id: userId },
    });

    logAuthentication('token_exchange', userId, true);

    // Return mock tokens for now
    // TODO: Implement proper Supabase session creation
    return {
      access_token: `supabase_jwt_${userId}_${Date.now()}`, // Placeholder
      refresh_token: `refresh_${userId}_${Date.now()}`, // Placeholder
      expires_in: config.jwtExpirySeconds,
      user_email: user.email!,
    };
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw error;
    }
    logger.error('Error exchanging code for tokens', { error });
    throw new AuthenticationError('Failed to exchange code for tokens');
  }
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<TokenRefreshResponse> {
  try {
    // Use Supabase's built-in token refresh
    const {
      data: { session },
      error,
    } = await supabase.auth.refreshSession({ refresh_token: refreshToken });

    if (error || !session) {
      logger.warn('Failed to refresh token', { error: error?.message });
      throw new AuthenticationError('Invalid or expired refresh token');
    }

    logAuthentication('token_refresh', session.user.id, true);

    return {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in || config.jwtExpirySeconds,
    };
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw error;
    }
    logger.error('Error refreshing access token', { error });
    throw new AuthenticationError('Failed to refresh access token');
  }
}

/**
 * Send OTP (one-time password) to user's email
 */
export async function sendOTP(
  email: string
): Promise<{ success: boolean; message: string }> {
  try {
    // Use Supabase's signInWithOtp for passwordless authentication
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true, // Auto-create user if they don't exist
      },
    });

    if (error) {
      logger.error('Failed to send OTP', { error, email });
      throw new ValidationError(error.message);
    }

    logger.info('OTP sent successfully', { email });

    return {
      success: true,
      message: 'OTP sent to your email',
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    logger.error('Error sending OTP', { error, email });
    throw new Error('Failed to send OTP');
  }
}

/**
 * Verify OTP and return user info
 */
export async function verifyOTP(
  email: string,
  token: string
): Promise<{ userId: string; email: string }> {
  try {
    // Verify the OTP token with Supabase
    const {
      data: { user, session },
      error,
    } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    });

    if (error) {
      logger.warn('Failed to verify OTP', { error: error.message, email });
      throw new AuthenticationError('Invalid or expired OTP');
    }

    if (!user || !session) {
      throw new AuthenticationError('OTP verification failed');
    }

    // Create user profile using Prisma (if not auto-created by trigger)
    try {
      await prisma.userProfile.upsert({
        where: { id: user.id },
        create: {
          id: user.id,
          primaryModel: 'claude-3-5-sonnet-20241022',
          fallbackModel: null,
        },
        update: {},
      });
    } catch (profileError) {
      logger.warn('Failed to create/update user profile', { error: profileError, userId: user.id });
    }

    logAuthentication('otp_login', user.id, true);

    return {
      userId: user.id,
      email: user.email!,
    };
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw error;
    }
    logger.error('Error verifying OTP', { error, email });
    throw new AuthenticationError('Failed to verify OTP');
  }
}

/**
 * Initiate Google OAuth flow
 * Returns the OAuth URL to redirect the user to
 */
export async function initiateGoogleOAuth(
  redirectUrl: string
): Promise<{ url: string }> {
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
      },
    });

    if (error) {
      logger.error('Failed to initiate Google OAuth', { error });
      throw new AuthenticationError('Failed to initiate Google OAuth');
    }

    if (!data.url) {
      throw new AuthenticationError('OAuth URL not generated');
    }

    logger.info('Google OAuth initiated', { redirectUrl });

    return {
      url: data.url,
    };
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw error;
    }
    logger.error('Error initiating Google OAuth', { error });
    throw new AuthenticationError('Failed to initiate Google OAuth');
  }
}

/**
 * Handle Google OAuth callback
 * Exchange the OAuth code for a Supabase session
 */
export async function handleGoogleCallback(
  code: string
): Promise<{ userId: string; email: string }> {
  try {
    // Exchange the OAuth code for a session
    const {
      data: { user, session },
      error,
    } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      logger.error('Failed to exchange OAuth code', { error });
      throw new AuthenticationError('Failed to authenticate with Google');
    }

    if (!user || !session) {
      throw new AuthenticationError('Google OAuth authentication failed');
    }

    // Create user profile using Prisma (if not auto-created by trigger)
    try {
      await prisma.userProfile.upsert({
        where: { id: user.id },
        create: {
          id: user.id,
          primaryModel: 'claude-3-5-sonnet-20241022',
          fallbackModel: null,
        },
        update: {},
      });
    } catch (profileError) {
      logger.warn('Failed to create/update user profile', { error: profileError, userId: user.id });
    }

    logAuthentication('google_oauth', user.id, true);

    return {
      userId: user.id,
      email: user.email!,
    };
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw error;
    }
    logger.error('Error handling Google OAuth callback', { error });
    throw new AuthenticationError('Failed to handle Google OAuth callback');
  }
}

/**
 * Get user profile with model preferences using Prisma
 */
export async function getUserProfile(userId: string) {
  try {
    const profile = await prisma.userProfile.findUnique({
      where: { id: userId },
    });

    if (!profile) {
      logger.warn('User profile not found', { userId });
      return null;
    }

    return profile;
  } catch (error) {
    logger.error('Error getting user profile', { error, userId });
    return null;
  }
}

/**
 * Update user model preferences using Prisma
 */
const DEFAULT_PRIMARY_MODEL = 'claude-3-5-sonnet-20241022';

export async function updateUserModelPreferences(
  userId: string,
  primaryModel?: string,
  fallbackModel?: string | null
) {
  try {
    const updateData: Prisma.UserProfileUpdateInput = {};
    if (primaryModel) {
      updateData.primaryModel = primaryModel;
    }
    if (fallbackModel !== undefined) {
      updateData.fallbackModel = fallbackModel;
    }

    if (Object.keys(updateData).length === 0) {
      logger.warn('No model preference fields provided for update', { userId });
      return;
    }

    const createData: Prisma.UserProfileCreateInput = {
      id: userId,
      primaryModel: primaryModel || DEFAULT_PRIMARY_MODEL,
    };

    if (fallbackModel !== undefined) {
      createData.fallbackModel = fallbackModel;
    }

    await prisma.userProfile.upsert({
      where: { id: userId },
      update: updateData,
      create: createData,
    });

    logger.info('Model preferences upserted', { userId, primaryModel, fallbackModel });
  } catch (error) {
    logger.error('Error updating model preferences', { error, userId });
    throw error;
  }
}

/**
 * Clean up expired authorization codes using Prisma
 */
export async function cleanupExpiredAuthCodes(): Promise<void> {
  try {
    const result = await prisma.authCode.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
        },
      },
    });

    logger.info('Expired auth codes cleaned up', { count: result.count });
  } catch (error) {
    logger.error('Error cleaning up expired auth codes', { error });
  }
}
