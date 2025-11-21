// TypeScript type definitions for driftal Backend

import { Request } from "express";
import { User } from "@supabase/supabase-js";

// ============================================================================
// Database Types
// ============================================================================

export interface UserProfile {
  id: string;
  email: string;
  created_at: string;
  updated_at: string;
}

export interface ReviewLog {
  id: string;
  user_id: string;
  email: string;
  model: string;
  total_tokens: number | null;
  lines_of_code_reviewed: number | null;
  review_duration_ms: number | null;
  repository_name: string | null;
  created_at: string;
}

export type Severity = "critical" | "high" | "medium" | "low";

export interface ReviewIssue {
  id: string;
  review_id: string;
  title: string;
  severity: Severity;
  file_path: string;
  line_number: number | null;
  description: string | null;
  suggestion: string | null;
  created_at: string;
}

// Usage stats from database function
export interface UsageStats {
  total_reviews: number;
  total_tokens: number;
  total_lines_reviewed: number;
  avg_tokens_per_review: number;
  avg_lines_per_review: number;
  avg_duration_ms: number;
  models_used: string[];
  repositories: string[];
}

// ============================================================================
// API Request/Response Types
// ============================================================================

// Authentication
export interface TokenExchangeRequest {
  code: string;
}

export interface TokenExchangeResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_email: string;
}

export interface TokenRefreshRequest {
  refresh_token: string;
}

export interface TokenRefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

// Code Review Logging
export interface CreateReviewRequest {
  email: string;
  model: string;
  total_tokens: number;
  lines_of_code_reviewed: number;
  review_duration_ms: number;
  repository_name?: string;
  issues: Array<{
    title: string;
    severity: Severity;
    file_path: string;
    line_number?: number;
    description?: string;
    suggestion?: string;
  }>;
}

export interface CreateReviewResponse {
  review_id: string;
  issues_created: number;
  message: string;
}

export interface GetReviewResponse {
  review: ReviewLog;
  issues: ReviewIssue[];
  issue_summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

// LLM Chat Completions
export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionRequest {
  messages: Message[];
  model?: string; // Optional, will use user's primary model if not provided
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
}

export interface ChatCompletionChoice {
  message: {
    role: "assistant";
    content: string;
  };
  finish_reason: "stop" | "length" | "content_filter" | null;
  index: number;
}

export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: ChatCompletionUsage;
}

// Streaming
export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: "assistant";
      content?: string;
    };
    finish_reason: "stop" | "length" | "content_filter" | null;
  }>;
}

// ============================================================================
// Provider-Specific Types
// ============================================================================

// OpenAI (already compatible with our standard format)
export type OpenAIRequest = ChatCompletionRequest;
export type OpenAIResponse = ChatCompletionResponse;

// Anthropic
export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  system?: string;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
}

export interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: Array<{
    type: "text";
    text: string;
  }>;
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// Gemini
export interface GeminiRequest {
  contents: Array<{
    role: "user" | "model";
    parts: Array<{
      text: string;
    }>;
  }>;
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    stopSequences?: string[];
  };
  systemInstruction?: {
    parts: Array<{
      text: string;
    }>;
  };
}

export interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
      role: string;
    };
    finishReason: string;
  }>;
  usageMetadata: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

// ============================================================================
// Express Types
// ============================================================================

export interface AuthenticatedRequest extends Request {
  user?: User;
  userId?: string;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface Config {
  // Server
  port: number;
  nodeEnv: "development" | "production" | "test";

  // Supabase
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  supabaseJwtSecret: string;

  // Redis
  redisUrl: string;
  redisToken: string;

  // LLM Providers
  openaiApiKey: string;
  anthropicApiKey: string;
  geminiApiKey: string;
  openrouterApiKey: string;

  // Moss (Semantic Code Search)
  mossProjectId: string;
  mossProjectKey: string;

  // Morph (Fast Apply)
  morphApiKey?: string;

  // Rate Limiting
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;

  // CORS
  allowedOrigins: string[];

  // URLs
  baseUrl: string;
  frontendUrl: string;
  cliCallbackUrlPattern: string;

  // Logging
  logLevel: "error" | "warn" | "info" | "debug";
  logFile?: string;

  // Authentication
  authCodeExpiryMinutes: number;
  jwtExpirySeconds: number;

  // Security
  forceHttps: boolean;
  trustProxy: boolean;
}

// ============================================================================
// Error Types
// ============================================================================

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public code?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "AppError";
    Error.captureStackTrace(this, this.constructor);
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = "Authentication failed", details?: unknown) {
    super(401, message, "AUTH_ERROR", details);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = "Not authorized", details?: unknown) {
    super(403, message, "AUTHORIZATION_ERROR", details);
    this.name = "AuthorizationError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string = "Validation failed", details?: unknown) {
    super(400, message, "VALIDATION_ERROR", details);
    this.name = "ValidationError";
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = "Rate limit exceeded", retryAfter?: number) {
    super(429, message, "RATE_LIMIT_ERROR", { retryAfter });
    this.name = "RateLimitError";
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = "Resource not found", details?: unknown) {
    super(404, message, "NOT_FOUND_ERROR", details);
    this.name = "NotFoundError";
  }
}

export class ProviderError extends AppError {
  constructor(
    message: string = "LLM provider error",
    provider: string,
    details?: Record<string, unknown>
  ) {
    super(502, message, "PROVIDER_ERROR", { provider, ...(details || {}) });
    this.name = "ProviderError";
  }
}

// ============================================================================
// Health Check Types
// ============================================================================

export interface HealthCheckResponse {
  status: "ok" | "degraded" | "error";
  supabase: "connected" | "disconnected";
  redis: "connected" | "disconnected";
  timestamp: string;
  version?: string;
}

// ============================================================================
// Model Mapping Types
// ============================================================================

export type LLMProvider = "openai" | "anthropic" | "gemini" | "openrouter";

export interface ModelInfo {
  name: string;
  provider: LLMProvider;
  maxTokens: number;
  supportsStreaming: boolean;
  description: string;
}

export const SUPPORTED_MODELS: Record<string, ModelInfo> = {
  // OpenAI models
  "gpt-5.1": {
    name: "GPT-5.1",
    provider: "openai",
    maxTokens: 8192,
    supportsStreaming: true,
    description: "Latest GPT-5 model",
  },
  "gpt-5.1-codex": {
    name: "GPT-5.1 Codex",
    provider: "openai",
    maxTokens: 8192,
    supportsStreaming: true,
    description: "GPT-5.1 optimized for code generation",
  },
  "gpt-5-codex": {
    name: "GPT-5 Codex",
    provider: "openai",
    maxTokens: 8192,
    supportsStreaming: true,
    description: "GPT-5 optimized for code generation",
  },
  "o4-mini": {
    name: "O4 Mini",
    provider: "openai",
    maxTokens: 4096,
    supportsStreaming: true,
    description: "Smaller, faster O4 model",
  },
  "gpt-5.1-codex-mini": {
    name: "GPT-5.1 Codex Mini",
    provider: "openai",
    maxTokens: 4096,
    supportsStreaming: true,
    description: "Compact GPT-5.1 Codex model",
  },
  o3: {
    name: "O3",
    provider: "openai",
    maxTokens: 8192,
    supportsStreaming: true,
    description: "O3 reasoning model",
  },
  // Google Gemini models
  "gemini-3-pro-preview": {
    name: "Gemini 3 Pro Preview",
    provider: "gemini",
    maxTokens: 8192,
    supportsStreaming: true,
    description: "Gemini 3 Pro preview model",
  },
  // OpenRouter models
  "anthropic/claude-sonnet-4.5": {
    name: "Claude Sonnet 4.5",
    provider: "openrouter",
    maxTokens: 8192,
    supportsStreaming: true,
    description: "Claude Sonnet 4.5",
  },
};
