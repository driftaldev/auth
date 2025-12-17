// LLM proxy service with model routing and usage tracking
// Uses Prisma ORM for database operations

import { prisma } from "./prisma.js";
import { makeLLMRequest, makeLLMStreamRequest } from "./llm.js";
import { logger } from "../config/logger.js";
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  SUPPORTED_MODELS,
  LLMProvider,
  ValidationError,
  NotFoundError,
} from "../types/index.js";

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
 * Get user's selected model (now returns default since preferences moved to CLI config)
 * Model preferences are now stored locally in ~/.driftal/config.json on the CLI side
 * The CLI should always provide the model in the request instead of relying on this function
 */
export async function getUserModel(userId: string): Promise<string> {
  logger.info(
    "getUserModel called - returning default model (preferences now in CLI config)",
    { userId }
  );
  // The CLI should always provide the model explicitly in requests
  return "gpt-5.1";
}

/**
 * Route LLM request to appropriate provider
 * Now uses unified LLM service with OpenAI SDK for all providers
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

    logger.info("Routing LLM request", {
      model,
      provider,
      userId,
    });

    const response = await makeLLMRequest(request, model, userId);

    const duration = Date.now() - startTime;

    // Log usage to database
    await logUsage(
      userId,
      model,
      provider,
      response.usage,
      duration,
      "success"
    );

    return response;
  } catch (error) {
    const duration = Date.now() - startTime;

    // Log failed request
    await logUsage(
      userId,
      request.model || "unknown",
      "unknown",
      null,
      duration,
      "error",
      error instanceof Error ? error.message : "Unknown error"
    );

    throw error;
  }
}

/**
 * Route streaming LLM request to appropriate provider
 * Now uses unified LLM service with OpenAI SDK for all providers
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

    logger.info("Routing streaming LLM request", {
      model,
      provider,
      userId,
    });

    // Use unified LLM service (handles all providers via OpenAI SDK)
    yield* makeLLMStreamRequest(request, model, userId);

    const duration = Date.now() - startTime;

    // Log successful streaming request
    // Note: Token usage is logged within the unified LLM service
    await logUsage(userId, model, provider, null, duration, "success");
  } catch (error) {
    const duration = Date.now() - startTime;

    // Log failed request
    await logUsage(
      userId,
      request.model || "unknown",
      "unknown",
      null,
      duration,
      "error",
      error instanceof Error ? error.message : "Unknown error"
    );

    throw error;
  }
}

async function logUsage(
  userId: string,
  model: string,
  provider: string,
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  } | null,
  duration: number,
  status: "success" | "error" | "rate_limited",
  errorMessage?: string
): Promise<void> {
  // Individual LLM request logging is disabled - only complete reviews are logged
  // This function is kept for API compatibility but does not write to database
  logger.debug(
    "Individual LLM request usage logging is disabled - only complete reviews are tracked",
    {
      userId,
      model,
      provider,
      totalTokens: usage?.total_tokens || 0,
    }
  );
}

/**
 * Log a complete code review to database
 */
export async function logReview(
  userId: string,
  email: string,
  model: string,
  totalTokens: number,
  linesOfCodeReviewed: number,
  reviewDurationMs: number,
  repositoryName: string | null,
  issues: Array<{
    title: string;
    severity: "critical" | "high" | "medium" | "low";
    file_path: string;
    line_number?: number;
    description?: string;
    suggestion?: string;
  }>
): Promise<{ reviewId: string; issuesCreated: number }> {
  try {
    // Ensure UserProfile exists before creating ReviewLog (foreign key constraint)
    await prisma.userProfile.upsert({
      where: { id: userId },
      create: {
        id: userId,
        email,
      },
      update: {
        email,
      },
    });

    // Create review log and issues in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create the review log
      const reviewLog = await tx.reviewLog.create({
        data: {
          userId,
          email,
          model,
          totalTokens,
          linesOfCodeReviewed,
          reviewDurationMs,
          repositoryName,
        },
      });

      // Create all issues for this review
      if (issues.length > 0) {
        await tx.reviewIssue.createMany({
          data: issues.map((issue) => ({
            reviewId: reviewLog.id,
            title: issue.title,
            severity: issue.severity,
            filePath: issue.file_path,
            lineNumber: issue.line_number || null,
            description: issue.description || null,
            suggestion: issue.suggestion || null,
          })),
        });
      }

      return {
        reviewId: reviewLog.id,
        issuesCreated: issues.length,
      };
    });

    logger.info("Review logged successfully", {
      reviewId: result.reviewId,
      userId,
      email,
      issuesCount: result.issuesCreated,
    });

    return result;
  } catch (error) {
    logger.error("Error logging review", { error, userId, email });
    throw error;
  }
}

/**
 * Get user review statistics using Prisma
 */
export async function getUserUsageStats(userId: string, days: number = 30) {
  try {
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Get review logs for the user within the time period
    const logs = await prisma.reviewLog.findMany({
      where: {
        userId,
        createdAt: {
          gte: sinceDate,
        },
      },
    });

    // Calculate statistics
    const totalReviews = logs.length;
    const totalTokens = logs.reduce(
      (sum, log) => sum + (log.totalTokens || 0),
      0
    );
    const totalLinesReviewed = logs.reduce(
      (sum, log) => sum + (log.linesOfCodeReviewed || 0),
      0
    );
    const totalDurationMs = logs.reduce(
      (sum, log) => sum + (log.reviewDurationMs || 0),
      0
    );
    const avgTokensPerReview =
      totalReviews > 0 ? totalTokens / totalReviews : 0;
    const avgLinesPerReview =
      totalReviews > 0 ? totalLinesReviewed / totalReviews : 0;
    const avgDurationMs = totalReviews > 0 ? totalDurationMs / totalReviews : 0;
    const modelsUsed = [...new Set(logs.map((log) => log.model))];
    const repositories = [
      ...new Set(logs.map((log) => log.repositoryName).filter(Boolean)),
    ];

    return {
      total_reviews: totalReviews,
      total_tokens: totalTokens,
      total_lines_reviewed: totalLinesReviewed,
      avg_tokens_per_review: Math.round(avgTokensPerReview * 100) / 100,
      avg_lines_per_review: Math.round(avgLinesPerReview * 100) / 100,
      avg_duration_ms: Math.round(avgDurationMs * 100) / 100,
      models_used: modelsUsed,
      repositories: repositories as string[],
    };
  } catch (error) {
    logger.error("Error getting usage stats", { error, userId });
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
    throw new ValidationError(
      "messages field is required and must be an array"
    );
  }

  if (request.messages.length === 0) {
    throw new ValidationError("messages array cannot be empty");
  }

  // Validate each message
  for (const message of request.messages) {
    if (
      !message.role ||
      !["system", "user", "assistant"].includes(message.role)
    ) {
      throw new ValidationError(
        "Each message must have a role of system, user, or assistant"
      );
    }

    if (typeof message.content !== "string") {
      throw new ValidationError("Each message must have a content string");
    }
  }

  // Validate optional fields
  if (request.temperature !== undefined) {
    if (
      typeof request.temperature !== "number" ||
      request.temperature < 0 ||
      request.temperature > 2
    ) {
      throw new ValidationError("temperature must be a number between 0 and 2");
    }
  }

  if (request.max_tokens !== undefined) {
    if (typeof request.max_tokens !== "number" || request.max_tokens < 1) {
      throw new ValidationError("max_tokens must be a positive number");
    }
  }

  if (request.stream !== undefined) {
    if (typeof request.stream !== "boolean") {
      throw new ValidationError("stream must be a boolean");
    }
  }

  if (request.model !== undefined) {
    if (typeof request.model !== "string") {
      throw new ValidationError("model must be a string");
    }
  }
}
