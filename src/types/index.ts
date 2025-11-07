// TypeScript type definitions for ScoutCLI Backend

import { Request } from 'express';
import { User } from '@supabase/supabase-js';

// ============================================================================
// Database Types
// ============================================================================

export interface UserProfile {
  id: string;
  primary_model: string;
  fallback_model: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthCode {
  code: string;
  user_id: string;
  state: string;
  expires_at: string;
  used: boolean;
  used_at: string | null;
  created_at: string;
}

export interface UsageLog {
  id: string;
  user_id: string;
  model: string;
  provider: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  request_duration_ms: number | null;
  status: 'success' | 'error' | 'rate_limited';
  error_message: string | null;
  created_at: string;
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

// LLM Chat Completions
export interface Message {
  role: 'system' | 'user' | 'assistant';
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
    role: 'assistant';
    content: string;
  };
  finish_reason: 'stop' | 'length' | 'content_filter' | null;
  index: number;
}

export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: ChatCompletionUsage;
}

// Streaming
export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
    };
    finish_reason: 'stop' | 'length' | 'content_filter' | null;
  }>;
}

// ============================================================================
// Provider-Specific Types
// ============================================================================

// OpenAI (already compatible with our standard format)
export type OpenAIRequest = ChatCompletionRequest;
export type OpenAIResponse = ChatCompletionResponse;

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
  nodeEnv: 'development' | 'production' | 'test';

  // Supabase
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  supabaseJwtSecret: string;

  // Redis
  redisUrl: string;

  // LLM Providers
  openaiApiKey: string;

  // Rate Limiting
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;

  // CORS
  allowedOrigins: string[];

  // URLs
  frontendUrl: string;
  cliCallbackUrlPattern: string;

  // Logging
  logLevel: 'error' | 'warn' | 'info' | 'debug';
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
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication failed', details?: unknown) {
    super(401, message, 'AUTH_ERROR', details);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Not authorized', details?: unknown) {
    super(403, message, 'AUTHORIZATION_ERROR', details);
    this.name = 'AuthorizationError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string = 'Validation failed', details?: unknown) {
    super(400, message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Rate limit exceeded', retryAfter?: number) {
    super(429, message, 'RATE_LIMIT_ERROR', { retryAfter });
    this.name = 'RateLimitError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found', details?: unknown) {
    super(404, message, 'NOT_FOUND_ERROR', details);
    this.name = 'NotFoundError';
  }
}

export class ProviderError extends AppError {
  constructor(
    message: string = 'LLM provider error',
    provider: string,
    details?: unknown
  ) {
    super(502, message, 'PROVIDER_ERROR', { provider, ...details });
    this.name = 'ProviderError';
  }
}

// ============================================================================
// Health Check Types
// ============================================================================

export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'error';
  supabase: 'connected' | 'disconnected';
  redis: 'connected' | 'disconnected';
  timestamp: string;
  version?: string;
}

// ============================================================================
// Model Mapping Types
// ============================================================================

export type LLMProvider = 'openai';

export interface ModelInfo {
  name: string;
  provider: LLMProvider;
  maxTokens: number;
  supportsStreaming: boolean;
}

export const SUPPORTED_MODELS: Record<string, ModelInfo> = {
  // OpenAI models
  'gpt-4-turbo': {
    name: 'gpt-4-turbo',
    provider: 'openai',
    maxTokens: 4096,
    supportsStreaming: true,
  },
  'gpt-4': {
    name: 'gpt-4',
    provider: 'openai',
    maxTokens: 8192,
    supportsStreaming: true,
  },
  'gpt-3.5-turbo': {
    name: 'gpt-3.5-turbo',
    provider: 'openai',
    maxTokens: 4096,
    supportsStreaming: true,
  },
};
