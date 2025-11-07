// LLM proxy service with model routing and usage tracking
// Uses Prisma ORM for database operations

import { prisma } from './prisma.js';
import { makeAnthropicRequest, makeAnthropicStreamRequest } from './anthropic.js';
import { makeOpenAIRequest, makeOpenAIStreamRequest } from './openai.js';
import { logger } from '../config/logger.js';
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  SUPPORTED_MODELS,
  LLMProvider,
  ValidationError,
  NotFoundError,
} from '../types/index.js';

/**
 * Get provider for a given model
 */
export function getProviderForModel(model: string): LLMProvider {
  const modelInfo = SUPPORTED_MODELS[model];

  if (!modelInfo) {
    throw new ValidationError(`Unsupported model: ${model}`, {
      supportedModels: Object.keys(SUPPORTED_MODELS),
    });
  }

  return modelInfo.provider;
}

/**
 * Get user's selected model from database using Prisma
 */
export async function getUserModel(userId: string): Promise<string> {
  try {
    const profile = await prisma.userProfile.findUnique({
      where: { id: userId },
      select: { primaryModel: true, fallbackModel: true },
    });

    if (!profile) {
      logger.warn('Failed to get user model preferences', { userId });
      // Default to Claude 3.5 Sonnet
      return 'claude-3-5-sonnet-20241022';
    }

    return profile.primaryModel;
  } catch (error) {
    logger.error('Error getting user model', { userId, error });
    return 'claude-3-5-sonnet-20241022';
  }
}

/**
 * Route LLM request to appropriate provider
 */
export async function routeLLMRequest(
  request: ChatCompletionRequest,
  userId: string
): Promise<ChatCompletionResponse> {
  const startTime = Date.now();

  try {
    // Determine which model to use
    let model: string;
    if (request.model) {
      model = request.model;
    } else {
      model = await getUserModel(userId);
    }

    // Validate model is supported
    if (!SUPPORTED_MODELS[model]) {
      throw new ValidationError(`Unsupported model: ${model}`, {
        requestedModel: model,
        supportedModels: Object.keys(SUPPORTED_MODELS),
      });
    }

    const provider = getProviderForModel(model);

    logger.info('Routing LLM request', { model, provider, userId });

    // Route to appropriate provider
    let response: ChatCompletionResponse;

    if (provider === 'anthropic') {
      response = await makeAnthropicRequest(request, model, userId);
    } else if (provider === 'openai') {
      response = await makeOpenAIRequest(request, model, userId);
    } else {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    const duration = Date.now() - startTime;

    // Log usage to database
    await logUsage(userId, model, provider, response.usage, duration, 'success');

    return response;
  } catch (error) {
    const duration = Date.now() - startTime;

    // Log failed request
    await logUsage(
      userId,
      request.model || 'unknown',
      'unknown',
      null,
      duration,
      'error',
      error instanceof Error ? error.message : 'Unknown error'
    );

    throw error;
  }
}

/**
 * Route streaming LLM request to appropriate provider
 */
export async function* routeLLMStreamRequest(
  request: ChatCompletionRequest,
  userId: string
): AsyncGenerator<ChatCompletionChunk> {
  const startTime = Date.now();
  let model: string;
  let provider: LLMProvider;

  try {
    // Determine which model to use
    if (request.model) {
      model = request.model;
    } else {
      model = await getUserModel(userId);
    }

    // Validate model is supported
    if (!SUPPORTED_MODELS[model]) {
      throw new ValidationError(`Unsupported model: ${model}`, {
        requestedModel: model,
        supportedModels: Object.keys(SUPPORTED_MODELS),
      });
    }

    provider = getProviderForModel(model);

    logger.info('Routing streaming LLM request', { model, provider, userId });

    // Route to appropriate provider
    if (provider === 'anthropic') {
      yield* makeAnthropicStreamRequest(request, model, userId);
    } else if (provider === 'openai') {
      yield* makeOpenAIStreamRequest(request, model, userId);
    } else {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    const duration = Date.now() - startTime;

    // Log successful streaming request
    // Note: Token usage is logged within the provider-specific functions
    await logUsage(userId, model, provider, null, duration, 'success');
  } catch (error) {
    const duration = Date.now() - startTime;

    // Log failed request
    await logUsage(
      userId,
      request.model || 'unknown',
      'unknown',
      null,
      duration,
      'error',
      error instanceof Error ? error.message : 'Unknown error'
    );

    throw error;
  }
}

/**
 * Log usage to database using Prisma
 */
async function logUsage(
  userId: string,
  model: string,
  provider: string,
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null,
  duration: number,
  status: 'success' | 'error' | 'rate_limited',
  errorMessage?: string
): Promise<void> {
  try {
    await prisma.usageLog.create({
      data: {
        userId,
        model,
        provider,
        promptTokens: usage?.prompt_tokens || null,
        completionTokens: usage?.completion_tokens || null,
        totalTokens: usage?.total_tokens || null,
        requestDurationMs: duration,
        status,
        errorMessage: errorMessage || null,
      },
    });
  } catch (error) {
    logger.error('Error logging usage', { error, userId, model });
  }
}

/**
 * Get user usage statistics using Prisma
 */
export async function getUserUsageStats(userId: string, days: number = 30) {
  try {
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Get usage logs for the user within the time period
    const logs = await prisma.usageLog.findMany({
      where: {
        userId,
        createdAt: {
          gte: sinceDate,
        },
        status: 'success',
      },
    });

    // Calculate statistics
    const totalRequests = logs.length;
    const totalTokens = logs.reduce((sum, log) => sum + (log.totalTokens || 0), 0);
    const totalPromptTokens = logs.reduce((sum, log) => sum + (log.promptTokens || 0), 0);
    const totalCompletionTokens = logs.reduce((sum, log) => sum + (log.completionTokens || 0), 0);
    const avgTokensPerRequest = totalRequests > 0 ? totalTokens / totalRequests : 0;
    const modelsUsed = [...new Set(logs.map(log => log.model))];

    return {
      total_requests: totalRequests,
      total_tokens: totalTokens,
      total_prompt_tokens: totalPromptTokens,
      total_completion_tokens: totalCompletionTokens,
      avg_tokens_per_request: Math.round(avgTokensPerRequest * 100) / 100,
      models_used: modelsUsed,
    };
  } catch (error) {
    logger.error('Error getting usage stats', { error, userId });
    return null;
  }
}

/**
 * Validate chat completion request
 */
export function validateChatCompletionRequest(
  request: any
): asserts request is ChatCompletionRequest {
  if (!request.messages || !Array.isArray(request.messages)) {
    throw new ValidationError('messages field is required and must be an array');
  }

  if (request.messages.length === 0) {
    throw new ValidationError('messages array cannot be empty');
  }

  // Validate each message
  for (const message of request.messages) {
    if (!message.role || !['system', 'user', 'assistant'].includes(message.role)) {
      throw new ValidationError(
        'Each message must have a role of system, user, or assistant'
      );
    }

    if (typeof message.content !== 'string') {
      throw new ValidationError('Each message must have a content string');
    }
  }

  // Validate optional fields
  if (request.temperature !== undefined) {
    if (typeof request.temperature !== 'number' || request.temperature < 0 || request.temperature > 2) {
      throw new ValidationError('temperature must be a number between 0 and 2');
    }
  }

  if (request.max_tokens !== undefined) {
    if (typeof request.max_tokens !== 'number' || request.max_tokens < 1) {
      throw new ValidationError('max_tokens must be a positive number');
    }
  }

  if (request.stream !== undefined) {
    if (typeof request.stream !== 'boolean') {
      throw new ValidationError('stream must be a boolean');
    }
  }

  if (request.model !== undefined) {
    if (typeof request.model !== 'string') {
      throw new ValidationError('model must be a string');
    }
  }
}
