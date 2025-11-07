// Configuration management with environment variable validation

import { z } from "zod";
import dotenv from "dotenv";
import { Config } from "../types/index.js";

// Load environment variables from .env file
dotenv.config();

// Zod schema for configuration validation
const configSchema = z.object({
  // Server
  PORT: z.string().default("3000").transform(Number),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // Supabase
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
  SUPABASE_ANON_KEY: z.string().min(1, "SUPABASE_ANON_KEY is required"),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  SUPABASE_JWT_SECRET: z.string().min(1, "SUPABASE_JWT_SECRET is required"),

  // Redis
  REDIS_URL: z.string().url("REDIS_URL must be a valid URL"),

  // LLM Providers
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().default("60000").transform(Number),
  RATE_LIMIT_MAX_REQUESTS: z.string().default("50").transform(Number),

  // CORS
  ALLOWED_ORIGINS: z
    .string()
    .default("http://localhost:8080,https://scoutcode.com,http://localhost:*")
    .transform((val) => val.split(",")),

  // URLs
  FRONTEND_URL: z.string().url().default("https://scoutcode.com"),
  CLI_CALLBACK_URL_PATTERN: z.string().default("http://localhost:*"),

  // Logging
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
  LOG_FILE: z.string().optional(),

  // Authentication
  AUTH_CODE_EXPIRY_MINUTES: z.string().default("10").transform(Number),
  JWT_EXPIRY_SECONDS: z.string().default("3600").transform(Number),

  // Security
  FORCE_HTTPS: z
    .string()
    .default("false")
    .transform((val) => val === "true"),
  TRUST_PROXY: z
    .string()
    .default("false")
    .transform((val) => val === "true"),
});

// Validate and parse environment variables
function loadConfig(): Config {
  try {
    const parsed = configSchema.parse(process.env);

    return {
      port: parsed.PORT,
      nodeEnv: parsed.NODE_ENV,
      supabaseUrl: parsed.SUPABASE_URL,
      supabaseAnonKey: parsed.SUPABASE_ANON_KEY,
      supabaseServiceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY,
      supabaseJwtSecret: parsed.SUPABASE_JWT_SECRET,
      redisUrl: parsed.REDIS_URL,
      anthropicApiKey: parsed.ANTHROPIC_API_KEY,
      openaiApiKey: parsed.OPENAI_API_KEY,
      rateLimitWindowMs: parsed.RATE_LIMIT_WINDOW_MS,
      rateLimitMaxRequests: parsed.RATE_LIMIT_MAX_REQUESTS,
      allowedOrigins: parsed.ALLOWED_ORIGINS,
      frontendUrl: parsed.FRONTEND_URL,
      cliCallbackUrlPattern: parsed.CLI_CALLBACK_URL_PATTERN,
      logLevel: parsed.LOG_LEVEL,
      logFile: parsed.LOG_FILE,
      authCodeExpiryMinutes: parsed.AUTH_CODE_EXPIRY_MINUTES,
      jwtExpirySeconds: parsed.JWT_EXPIRY_SECONDS,
      forceHttps: parsed.FORCE_HTTPS,
      trustProxy: parsed.TRUST_PROXY,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("❌ Configuration validation failed:");
      error.errors.forEach((err) => {
        console.error(`  - ${err.path.join(".")}: ${err.message}`);
      });
      console.error(
        "\n💡 Please check your .env file and ensure all required variables are set."
      );
      console.error("   See .env.example for reference.\n");
    } else {
      console.error("❌ Failed to load configuration:", error);
    }
    process.exit(1);
  }
}

// Export validated configuration
export const config = loadConfig();

// Helper function to check if running in production
export const isProduction = () => config.nodeEnv === "production";

// Helper function to check if running in development
export const isDevelopment = () => config.nodeEnv === "development";

// Helper function to check if running in test
export const isTest = () => config.nodeEnv === "test";

// Log loaded configuration (sanitized)
if (!isTest()) {
  console.log("✅ Configuration loaded successfully");
  console.log(`   Environment: ${config.nodeEnv}`);
  console.log(`   Port: ${config.port}`);
  console.log(`   Log Level: ${config.logLevel}`);
  console.log(`   Supabase URL: ${config.supabaseUrl}`);
  console.log(
    `   Redis URL: ${config.redisUrl.replace(/:([^@]+)@/, ":****@")}`
  ); // Hide password
  console.log("");
}
