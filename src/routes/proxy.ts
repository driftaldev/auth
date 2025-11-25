// LLM proxy routes

import { Router, Request, Response } from "express";
import { asyncHandler } from "../middleware/error.js";
import { verifyToken } from "../middleware/auth.js";
import { llmRateLimiter } from "../middleware/rate-limit.js";
import {
  routeLLMRequest,
  routeLLMStreamRequest,
  validateChatCompletionRequest,
  getUserUsageStats,
  logReview,
} from "../services/proxy.js";
import { logger } from "../config/logger.js";
import { config } from "../config/index.js";
import { ChatCompletionChunk } from "../types/index.js";

const router = Router();

// All proxy routes require authentication
router.use(verifyToken);

// ============================================================================
// Routes
// ============================================================================

/**
 * Chat completions handler for /v1/chat/completions
 */
const chatCompletionsHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.userId!;

    // Validate request body
    validateChatCompletionRequest(req.body);

    const chatRequest = req.body;
    const isStreaming = chatRequest.stream === true;

    logger.info("Chat completion request", {
      userId,
      model: chatRequest.model || "default",
      streaming: isStreaming,
      messageCount: chatRequest.messages.length,
    });

    if (isStreaming) {
      // Handle streaming response - OpenAI format (SSE with data: prefix)
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
      res.flushHeaders();

      try {
        const stream = routeLLMStreamRequest(chatRequest, userId);

        let chunkCount = 0;
        for await (const chunk of stream) {
          chunkCount++;
          logger.debug(`Streaming chunk ${chunkCount}`, {
            hasChoices: !!chunk.choices,
            hasDelta: !!chunk.choices?.[0]?.delta,
            deltaContent: chunk.choices?.[0]?.delta?.content?.substring(0, 50),
            finishReason: chunk.choices?.[0]?.finish_reason,
          });

          // OpenAI streaming format: data: {json}\n\n
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        logger.info(`Streaming complete: ${chunkCount} chunks sent`);

        // Send done signal
        res.write("data: [DONE]\n\n");
        res.end();
      } catch (error) {
        logger.error("Streaming error", { error, userId });
        // Send error as SSE
        res.write(
          `data: ${JSON.stringify({
            error: error instanceof Error ? error.message : "Unknown error",
          })}\n\n`
        );
        res.end();
      }
    } else {
      // Handle non-streaming response
      const response = await routeLLMRequest(chatRequest, userId);
      res.json(response);
    }
  }
);

/**
 * POST /v1/chat/completions
 * Proxy LLM requests to any supported provider via unified OpenAI SDK interface
 *
 * Headers:
 *   Authorization: Bearer <access_token>
 *
 * Request body:
 *   {
 *     messages: [
 *       { role: "system", content: "You are a code reviewer" },
 *       { role: "user", content: "Review this code..." }
 *     ],
 *     model: "claude-3-5-sonnet-20241022" (optional, uses user's primary model if not provided),
 *     temperature: 0.3 (optional),
 *     max_tokens: 4096 (optional),
 *     stream: false (optional)
 *   }
 *
 * Response (non-streaming):
 *   {
 *     choices: [{
 *       message: {
 *         role: "assistant",
 *         content: "The response text..."
 *       },
 *       finish_reason: "stop"
 *     }],
 *     usage: {
 *       prompt_tokens: 100,
 *       completion_tokens: 50,
 *       total_tokens: 150
 *     }
 *   }
 *
 * Response (streaming):
 *   Server-Sent Events (SSE) stream with data chunks
 */
router.post("/v1/chat/completions", llmRateLimiter, chatCompletionsHandler);

/**
 * GET /v1/usage
 * Get usage statistics for the authenticated user
 *
 * Headers:
 *   Authorization: Bearer <access_token>
 *
 * Query parameters:
 *   days: number (optional, default: 30)
 *
 * Response:
 *   {
 *     total_requests: 150,
 *     total_tokens: 50000,
 *     total_prompt_tokens: 30000,
 *     total_completion_tokens: 20000,
 *     avg_tokens_per_request: 333.33,
 *     models_used: ["claude-3-5-sonnet-20241022", "gpt-4"]
 *   }
 */
router.get(
  "/v1/usage",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.userId!;
    const days = parseInt(req.query.days as string) || 30;

    logger.info("Usage stats request", { userId, days });

    const stats = await getUserUsageStats(userId, days);

    if (!stats) {
      res.json({
        total_reviews: 0,
        total_tokens: 0,
        total_lines_reviewed: 0,
        avg_tokens_per_review: 0,
        avg_lines_per_review: 0,
        avg_duration_ms: 0,
        models_used: [],
        repositories: [],
      });
      return;
    }

    res.json(stats);
  })
);

/**
 * POST /v1/reviews
 * Log a completed code review with metadata and issues
 *
 * Headers:
 *   Authorization: Bearer <access_token>
 *
 * Request body:
 *   {
 *     email: "user@example.com",
 *     model: "claude-3-5-sonnet-20241022",
 *     total_tokens: 15000,
 *     lines_of_code_reviewed: 450,
 *     review_duration_ms: 32000,
 *     repository_name: "my-repo" (optional),
 *     issues: [
 *       {
 *         title: "Potential SQL injection vulnerability",
 *         severity: "critical",
 *         file_path: "src/database/queries.ts",
 *         line_number: 42,
 *         description: "User input is directly concatenated...",
 *         suggestion: "Use parameterized queries..."
 *       }
 *     ]
 *   }
 *
 * Response:
 *   {
 *     review_id: "uuid",
 *     issues_created: 5,
 *     message: "Review logged successfully"
 *   }
 */
router.post(
  "/v1/reviews",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.userId!;
    const {
      email,
      model,
      total_tokens,
      lines_of_code_reviewed,
      review_duration_ms,
      repository_name,
      issues = [],
    } = req.body;

    // Validate required fields
    if (
      !email ||
      !model ||
      total_tokens === undefined ||
      lines_of_code_reviewed === undefined ||
      review_duration_ms === undefined
    ) {
      res.status(400).json({
        error:
          "Missing required fields: email, model, total_tokens, lines_of_code_reviewed, review_duration_ms",
      });
      return;
    }

    // Validate issue structure
    if (!Array.isArray(issues)) {
      res.status(400).json({
        error: "issues must be an array",
      });
      return;
    }

    for (const issue of issues) {
      if (!issue.title || !issue.severity || !issue.file_path) {
        res.status(400).json({
          error: "Each issue must have title, severity, and file_path",
        });
        return;
      }
      if (!["critical", "high", "medium", "low"].includes(issue.severity)) {
        res.status(400).json({
          error: "Issue severity must be critical, high, medium, or low",
        });
        return;
      }
    }

    logger.info("Review logging request", {
      userId,
      email,
      model,
      totalTokens: total_tokens,
      linesReviewed: lines_of_code_reviewed,
      issuesCount: issues.length,
      repository: repository_name,
    });

    try {
      const result = await logReview(
        userId,
        email,
        model,
        total_tokens,
        lines_of_code_reviewed,
        review_duration_ms,
        repository_name || null,
        issues
      );

      res.status(201).json({
        review_id: result.reviewId,
        issues_created: result.issuesCreated,
        message: "Review logged successfully",
      });
    } catch (error) {
      logger.error("Failed to log review", { error, userId });
      res.status(500).json({
        error: "Failed to log review",
      });
    }
  })
);

/**
 * GET /v1/models
 * List available models for the authenticated user
 *
 * Headers:
 *   Authorization: Bearer <access_token>
 *
 * Response:
 *   {
 *     models: [
 *       {
 *         id: "claude-3-5-sonnet-20241022",
 *         provider: "anthropic",
 *         max_tokens: 8192
 *       },
 *       ...
 *     ]
 *   }
 */
router.get(
  "/v1/models",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.userId!;

    logger.debug("Models list request", { userId });

    // Import SUPPORTED_MODELS from types
    const { SUPPORTED_MODELS } = await import("../types/index.js");

    const models = Object.entries(SUPPORTED_MODELS).map(([id, info]) => ({
      id,
      name: info.name,
      provider: info.provider,
      description: info.description,
      max_tokens: info.maxTokens,
      supports_streaming: info.supportsStreaming,
      api_type: info.apiType,
    }));

    res.json({ models });
  })
);

/**
 * GET /v1/moss/credentials
 * Get Moss project credentials for authenticated users
 *
 * Headers:
 *   Authorization: Bearer <access_token>
 *
 * Response:
 *   {
 *     project_id: "277ab6a1-e353-40f6-b1e5-1d12bd5e2ab6",
 *     project_key: "moss_82dsnxO2GYhzPSWuAQtQVuYjDQae0LV6"
 *   }
 */
router.get(
  "/v1/moss/credentials",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.userId!;

    logger.debug("Moss credentials request", { userId });

    res.json({
      project_id: config.mossProjectId,
      project_key: config.mossProjectKey,
    });
  })
);

/**
 * GET /v1/morph/credentials
 * Get Morph API key for authenticated users
 *
 * Headers:
 *   Authorization: Bearer <access_token>
 *
 * Response:
 *   {
 *     api_key: "morph_xxxxxxxxxxxxx"
 *   }
 *
 * Error Response (if not configured):
 *   Status: 503
 *   {
 *     error: "Morph credentials not configured on server"
 *   }
 */
router.get(
  "/v1/morph/credentials",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.userId!;

    logger.debug("Morph credentials request", { userId });

    if (!config.morphApiKey) {
      res.status(503).json({
        error: "Morph credentials not configured on server",
      });
      return;
    }

    res.json({
      api_key: config.morphApiKey,
    });
  })
);

export default router;
