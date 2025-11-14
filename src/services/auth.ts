// Authentication service with OAuth logic
// Uses Prisma ORM for database operations

import { randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { supabase } from "./supabase.js";
import { config } from "../config/index.js";
import { logger, logAuthentication } from "../config/logger.js";
import {
  AuthenticationError,
  ValidationError,
  TokenExchangeResponse,
  TokenRefreshResponse,
} from "../types/index.js";
import { getRedisClient } from "../middleware/rate-limit.js";

/**
 * Generate a random authorization code
 */
export function generateAuthCode(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Create an authorization code for OAuth flow
 * Stores a temporary mapping in Redis to allow token exchange
 */
export async function createAuthorizationCode(
  userId: string,
  state: string
): Promise<string> {
  // Generate a random authorization code
  const code = generateAuthCode();

  // Store code -> userId mapping in Redis with 10 minute TTL
  // This allows the token exchange endpoint to create a session for the user
  try {
    const redis = getRedisClient();
    const key = `auth_code:${code}`;
    await redis.set(key, userId, { ex: 600 }); // 10 minutes expiration
  } catch (error) {
    logger.error("Failed to store auth code in Redis", { error, userId });
    throw new AuthenticationError(
      "Failed to create authorization code. Please try again.",
      { originalError: error instanceof Error ? error.message : String(error) }
    );
  }

  logger.info("Authorization code generated", {
    userId,
    state,
    codePrefix: code.substring(0, 8) + "...",
  });

  return code;
}

/**
 * DEPRECATED: Auth code validation moved to client-side
 * This function has been removed as part of schema migration
 */
// export async function validateAuthorizationCode(
//   code: string
// ): Promise<{ userId: string; state: string }> {
//   // Auth codes now handled client-side
//   throw new Error('Auth code validation is now managed locally in CLI');
// }

/**
 * Store session tokens for a user (called after OAuth/OTP login)
 * These tokens will be retrieved when exchanging an auth code
 */
export async function storeUserSessionTokens(
  userId: string,
  accessToken: string,
  refreshToken: string
): Promise<void> {
  try {
    const redis = getRedisClient();
    const key = `user_session:${userId}`;
    const sessionData = JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    // Store for 10 minutes - enough time for the user to authorize
    await redis.set(key, sessionData, { ex: 600 });
  } catch (error) {
    logger.error("Failed to store session tokens in Redis", { error, userId });
    // Don't throw - this is not critical for the auth flow
  }
}

/**
 * Exchange authorization code for access and refresh tokens
 * Retrieves stored session tokens for the user associated with the code
 */
export async function exchangeCodeForTokens(
  code: string
): Promise<TokenExchangeResponse> {
  try {
    // Look up user_id from Redis using the auth code
    const redis = getRedisClient();
    const codeKey = `auth_code:${code}`;

    let userId: string | null;
    try {
      userId = await redis.get<string>(codeKey);
    } catch (redisError) {
      logger.error("Redis error while looking up auth code", {
        error: redisError,
        codePrefix: code.substring(0, 8) + "...",
      });
      throw new AuthenticationError(
        "Failed to verify authorization code. Please try again.",
        {
          originalError:
            redisError instanceof Error
              ? redisError.message
              : String(redisError),
        }
      );
    }

    if (!userId) {
      logger.warn("Invalid or expired authorization code", {
        codePrefix: code.substring(0, 8) + "...",
      });
      throw new AuthenticationError("Invalid or expired authorization code");
    }

    // Delete the code from Redis (one-time use)
    try {
      await redis.del(codeKey);
    } catch (redisError) {
      logger.warn("Failed to delete auth code from Redis", {
        error: redisError,
        codePrefix: code.substring(0, 8) + "...",
      });
      // Continue - code deletion failure is not critical
    }

    // Get stored session tokens for this user
    const sessionKey = `user_session:${userId}`;
    let sessionDataStr: string | null;
    try {
      sessionDataStr = await redis.get<string>(sessionKey);
    } catch (redisError) {
      logger.error("Redis error while retrieving session tokens", {
        error: redisError,
        userId,
      });
      throw new AuthenticationError(
        "Failed to retrieve session tokens. Please try again.",
        {
          originalError:
            redisError instanceof Error
              ? redisError.message
              : String(redisError),
        }
      );
    }

    if (!sessionDataStr) {
      logger.warn("No session tokens found for user", { userId });
      throw new AuthenticationError(
        "Session expired. Please log in again and authorize."
      );
    }

    // Log what we retrieved from Redis for debugging
    const sessionDataType = typeof sessionDataStr;
    const sessionDataPreview =
      typeof sessionDataStr === "string"
        ? sessionDataStr.substring(0, 200)
        : JSON.stringify(sessionDataStr).substring(0, 200);

    logger.debug("Retrieved session data from Redis", {
      userId,
      sessionDataLength:
        typeof sessionDataStr === "string"
          ? sessionDataStr.length
          : JSON.stringify(sessionDataStr).length,
      sessionDataType,
      sessionDataPreview,
    });

    // Delete the session tokens (one-time use)
    try {
      await redis.del(sessionKey);
    } catch (redisError) {
      logger.warn("Failed to delete session tokens from Redis", {
        error: redisError,
        userId,
      });
      // Continue - deletion failure is not critical
    }

    let sessionData: {
      access_token: string;
      refresh_token: string;
    };

    // Handle case where Redis returns already-parsed object vs string
    try {
      if (typeof sessionDataStr === "string") {
        // Parse string JSON
        sessionData = JSON.parse(sessionDataStr) as {
          access_token: string;
          refresh_token: string;
        };
      } else if (
        typeof sessionDataStr === "object" &&
        sessionDataStr !== null
      ) {
        // Already an object, use it directly
        sessionData = sessionDataStr as {
          access_token: string;
          refresh_token: string;
        };
      } else {
        throw new Error(
          `Unexpected session data type: ${typeof sessionDataStr}`
        );
      }
    } catch (parseError) {
      // Enhanced error logging for JSON parse failures
      const parseErrorDetails: Record<string, unknown> = {
        errorType: parseError?.constructor?.name || typeof parseError,
        errorMessage:
          parseError instanceof Error ? parseError.message : String(parseError),
        errorStack: parseError instanceof Error ? parseError.stack : undefined,
        userId,
        sessionDataType: typeof sessionDataStr,
        sessionDataLength:
          typeof sessionDataStr === "string"
            ? sessionDataStr.length
            : JSON.stringify(sessionDataStr).length,
        sessionDataPreview:
          typeof sessionDataStr === "string"
            ? sessionDataStr.substring(0, 200)
            : JSON.stringify(sessionDataStr).substring(0, 200),
        sessionDataFull:
          typeof sessionDataStr === "string"
            ? sessionDataStr
            : JSON.stringify(sessionDataStr),
        sessionDataIsString: typeof sessionDataStr === "string",
      };

      // Try to serialize parse error
      try {
        parseErrorDetails.parseErrorJSON = JSON.stringify(
          parseError,
          Object.getOwnPropertyNames(parseError)
        );
      } catch {
        parseErrorDetails.parseErrorJSON = "Failed to serialize parse error";
      }

      logger.error("Failed to parse session tokens", parseErrorDetails);
      throw new AuthenticationError("Invalid session data format");
    }

    // Get user from Supabase to retrieve email
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.admin.getUserById(userId);

    if (userError || !user || !user.email) {
      logger.error("Failed to get user from Supabase", {
        error: userError,
        userId,
      });
      throw new AuthenticationError("Failed to retrieve user information");
    }

    logAuthentication("token_exchange", userId, true);

    return {
      access_token: sessionData.access_token,
      refresh_token: sessionData.refresh_token,
      expires_in: config.jwtExpirySeconds, // This will be ignored by CLI (sets expiresAt to undefined)
      user_email: user.email,
    };
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw error;
    }

    // Better error serialization for logging
    const errorDetails: Record<string, unknown> = {
      errorType: error?.constructor?.name || typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      errorString: String(error),
    };

    // Try to serialize error with all properties
    try {
      errorDetails.errorJSON = JSON.stringify(
        error,
        Object.getOwnPropertyNames(error)
      );
    } catch {
      // If JSON.stringify fails, try with a replacer function
      try {
        errorDetails.errorJSON = JSON.stringify(error, (key, value) => {
          if (value instanceof Error) {
            return {
              name: value.name,
              message: value.message,
              stack: value.stack,
            };
          }
          return value;
        });
      } catch {
        errorDetails.errorJSON = "Failed to serialize error";
      }
    }

    logger.error("Error exchanging code for tokens", {
      ...errorDetails,
      codePrefix: code?.substring(0, 8) + "...",
    });

    // In development, include more details about the error
    const errorMessage = error instanceof Error ? error.message : String(error);
    const message =
      config.nodeEnv === "development"
        ? `Failed to exchange authorization code: ${errorMessage}`
        : "Failed to exchange authorization code";

    throw new AuthenticationError(message, {
      originalError:
        config.nodeEnv === "development" ? errorMessage : undefined,
    });
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
      logger.warn("Failed to refresh token", { error: error?.message });
      throw new AuthenticationError("Invalid or expired refresh token");
    }

    logAuthentication("token_refresh", session.user.id, true);

    return {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in || config.jwtExpirySeconds,
    };
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw error;
    }
    logger.error("Error refreshing access token", { error });
    throw new AuthenticationError("Failed to refresh access token");
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
      logger.error("Failed to send OTP", { error, email });
      throw new ValidationError(error.message);
    }

    logger.info("OTP sent successfully", { email });

    return {
      success: true,
      message: "OTP sent to your email",
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    logger.error("Error sending OTP", { error, email });
    throw new Error("Failed to send OTP");
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
      type: "email",
    });

    if (error) {
      logger.warn("Failed to verify OTP", { error: error.message, email });
      throw new AuthenticationError("Invalid or expired OTP");
    }

    if (!user || !session) {
      throw new AuthenticationError("OTP verification failed");
    }

    // Create user profile using Prisma (if not auto-created by trigger)
    // Note: Email is automatically populated by database trigger
    try {
      await prisma.userProfile.upsert({
        where: { id: user.id },
        create: {
          id: user.id,
          email: user.email!,
        } as Prisma.UserProfileCreateInput,
        update: {},
      });
    } catch (profileError) {
      logger.warn("Failed to create/update user profile", {
        error: profileError,
        userId: user.id,
      });
    }

    // Store session tokens for later token exchange
    await storeUserSessionTokens(
      user.id,
      session.access_token,
      session.refresh_token
    );

    logAuthentication("otp_login", user.id, true);

    return {
      userId: user.id,
      email: user.email!,
    };
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw error;
    }
    logger.error("Error verifying OTP", { error, email });
    throw new AuthenticationError("Failed to verify OTP");
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
      provider: "google",
      options: {
        redirectTo: redirectUrl,
        // Force authorization code flow instead of implicit flow
        // This ensures Google returns a code parameter instead of tokens in URL fragment
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
        // Skip browser redirect since we're on the server and will return the URL
        skipBrowserRedirect: true,
      },
    });

    if (error) {
      logger.error("Failed to initiate Google OAuth", { error });
      throw new AuthenticationError("Failed to initiate Google OAuth");
    }

    if (!data.url) {
      throw new AuthenticationError("OAuth URL not generated");
    }

    logger.info("Google OAuth initiated", { redirectUrl });

    return {
      url: data.url,
    };
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw error;
    }
    logger.error("Error initiating Google OAuth", { error });
    throw new AuthenticationError("Failed to initiate Google OAuth");
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
      logger.error("Failed to exchange OAuth code", { error });
      throw new AuthenticationError("Failed to authenticate with Google");
    }

    if (!user || !session) {
      throw new AuthenticationError("Google OAuth authentication failed");
    }

    // Create user profile using Prisma (if not auto-created by trigger)
    // Note: Email is automatically populated by database trigger
    try {
      await prisma.userProfile.upsert({
        where: { id: user.id },
        create: {
          id: user.id,
          email: user.email!,
        } as Prisma.UserProfileCreateInput,
        update: {},
      });
    } catch (profileError) {
      logger.warn("Failed to create/update user profile", {
        error: profileError,
        userId: user.id,
      });
    }

    // Store session tokens for later token exchange
    await storeUserSessionTokens(
      user.id,
      session.access_token,
      session.refresh_token
    );

    logAuthentication("google_oauth", user.id, true);

    return {
      userId: user.id,
      email: user.email!,
    };
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw error;
    }
    logger.error("Error handling Google OAuth callback", { error });
    throw new AuthenticationError("Failed to handle Google OAuth callback");
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
      logger.warn("User profile not found", { userId });
      return null;
    }

    return profile;
  } catch (error) {
    logger.error("Error getting user profile", { error, userId });
    return null;
  }
}

/**
 * DEPRECATED: Model preferences are now stored locally in CLI config (~/.driftal/config.json)
 * This function has been removed as part of schema migration
 */
const DEFAULT_PRIMARY_MODEL = "claude-3-5-sonnet-20241022";

export async function updateUserModelPreferences(
  userId: string,
  primaryModel?: string,
  fallbackModel?: string | null
) {
  // Model preferences now managed client-side in CLI config
  logger.warn(
    "Model preferences endpoint deprecated - preferences now stored in CLI config",
    {
      userId,
      primaryModel,
      fallbackModel,
    }
  );
  throw new Error(
    "Model preferences are now managed locally in CLI config (~/.driftal/config.json)"
  );
}

/**
 * DEPRECATED: Auth code cleanup no longer needed (codes stored locally in CLI)
 * This function has been removed as part of schema migration
 */
// export async function cleanupExpiredAuthCodes(): Promise<void> {
//   // Auth codes now handled client-side, no cleanup needed
// }
