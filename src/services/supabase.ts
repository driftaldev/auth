// Supabase client initialization for backend service
// NOTE: Prisma is now used for database operations
// Supabase is only used for authentication (JWT verification, user management)

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config/index.js";
import { logger } from "../config/logger.js";
import { verifyPrismaConnection } from "./prisma.js";

// Database types
export interface Database {
  public: {
    Tables: {
      user_profiles: {
        Row: {
          id: string;
          primary_model: string;
          fallback_model: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          primary_model?: string;
          fallback_model?: string | null;
        };
        Update: {
          primary_model?: string;
          fallback_model?: string | null;
        };
      };
      auth_codes: {
        Row: {
          code: string;
          user_id: string;
          state: string;
          expires_at: string;
          used: boolean;
          used_at: string | null;
          created_at: string;
        };
        Insert: {
          code: string;
          user_id: string;
          state: string;
          expires_at: string;
          used?: boolean;
        };
        Update: {
          used?: boolean;
          used_at?: string | null;
        };
      };
      usage_logs: {
        Row: {
          id: string;
          user_id: string;
          model: string;
          provider: string;
          prompt_tokens: number | null;
          completion_tokens: number | null;
          total_tokens: number | null;
          request_duration_ms: number | null;
          status: "success" | "error" | "rate_limited";
          error_message: string | null;
          created_at: string;
        };
        Insert: {
          user_id: string;
          model: string;
          provider: string;
          prompt_tokens?: number | null;
          completion_tokens?: number | null;
          total_tokens?: number | null;
          request_duration_ms?: number | null;
          status?: "success" | "error" | "rate_limited";
          error_message?: string | null;
        };
      };
    };
  };
}

// Supabase client with service role key (bypasses RLS for backend operations)
let supabaseClient: SupabaseClient<Database> | null = null;

export function initializeSupabase(): SupabaseClient<Database> {
  if (supabaseClient) {
    return supabaseClient;
  }

  try {
    supabaseClient = createClient<Database>(
      config.supabaseUrl,
      config.supabaseServiceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: true,
          flowType: "pkce",
        },

        global: {
          headers: {
            "X-Client-Info": "driftal-backend",
          },
        },
      }
    );

    logger.info("Supabase client initialized successfully");
    return supabaseClient;
  } catch (error) {
    logger.error("Failed to initialize Supabase client", { error });
    throw new Error("Failed to initialize Supabase client");
  }
}

// Get the initialized Supabase client
export function getSupabase(): SupabaseClient<Database> {
  if (!supabaseClient) {
    return initializeSupabase();
  }
  return supabaseClient;
}

// Verify Supabase connection
// NOTE: This now verifies both Supabase Auth and Prisma database
export async function verifySupabaseConnection(): Promise<boolean> {
  try {
    // Verify Supabase Auth is accessible
    const supabase = getSupabase();

    // Simple check - try to access auth admin
    const { error } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1,
    });

    if (error) {
      logger.error("Supabase Auth verification failed", {
        error: error.message,
      });
      return false;
    }

    // Also verify Prisma connection
    const prismaConnected = await verifyPrismaConnection();
    if (!prismaConnected) {
      logger.error("Prisma connection verification failed");
      return false;
    }

    logger.info("Supabase Auth and Prisma database verified");
    return true;
  } catch (error) {
    logger.error("Supabase/Prisma connection verification error", { error });
    return false;
  }
}

// Export singleton
export const supabase = getSupabase();
