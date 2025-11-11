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
 * POST /v1/chat/completions
 * Proxy LLM requests to Anthropic or OpenAI based on user's selected model
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
router.post(
  "/v1/chat/completions",
  llmRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
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
      // Handle streaming response with Server-Sent Events
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      try {
        const stream = routeLLMStreamRequest(chatRequest, userId);

        for await (const chunk of stream) {
          // Send chunk as SSE data
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        // Send done signal
        res.write("data: [DONE]\n\n");
        res.end();
      } catch (error) {
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
  })
);

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
        total_requests: 0,
        total_tokens: 0,
        total_prompt_tokens: 0,
        total_completion_tokens: 0,
        avg_tokens_per_request: 0,
        models_used: [],
      });
      return;
    }

    res.json(stats);
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
      provider: info.provider,
      max_tokens: info.maxTokens,
      supports_streaming: info.supportsStreaming,
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
