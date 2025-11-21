// Anthropic API service with request/response transformation

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config/index.js";
import { logger, logLLMRequest } from "../config/logger.js";
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  AnthropicRequest,
  AnthropicResponse,
  ProviderError,
  Message,
} from "../types/index.js";

// Initialize Anthropic client
let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: config.anthropicApiKey,
    });
    logger.info("Anthropic client initialized");
  }
  return anthropicClient;
}

/**
 * Transform standard chat completion request to Anthropic format
 */
function transformToAnthropicFormat(
  request: ChatCompletionRequest,
  model: string
): AnthropicRequest {
  // Extract system message (Anthropic uses separate system parameter)
  const systemMessages = request.messages.filter((m) => m.role === "system");
  const systemContent = systemMessages.map((m) => m.content).join("\n");

  // Filter out system messages from regular messages
  const messages = request.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  const anthropicRequest: AnthropicRequest = {
    model,
    max_tokens: request.max_tokens || 4096,
    messages,
    ...(systemContent && { system: systemContent }),
    ...(request.temperature !== undefined && {
      temperature: request.temperature,
    }),
    ...(request.top_p !== undefined && { top_p: request.top_p }),
    ...(request.stop && {
      stop_sequences: Array.isArray(request.stop)
        ? request.stop
        : [request.stop],
    }),
    ...(request.stream !== undefined && { stream: request.stream }),
  };

  return anthropicRequest;
}

/**
 * Transform Anthropic response to standard chat completion format
 */
function transformFromAnthropicFormat(
  response: AnthropicResponse,
  model: string
): ChatCompletionResponse {
  const content = response.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");

  return {
    id: response.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
        },
        finish_reason: mapAnthropicStopReason(response.stop_reason),
      },
    ],
    usage: {
      prompt_tokens: response.usage.input_tokens,
      completion_tokens: response.usage.output_tokens,
      total_tokens: response.usage.input_tokens + response.usage.output_tokens,
    },
  };
}

/**
 * Map Anthropic stop reason to standard format
 */
function mapAnthropicStopReason(
  stopReason: string | null
): "stop" | "length" | "content_filter" | null {
  switch (stopReason) {
    case "end_turn":
      return "stop";
    case "max_tokens":
      return "length";
    case "stop_sequence":
      return "stop";
    default:
      return null;
  }
}

/**
 * Make a non-streaming request to Anthropic
 */
export async function makeAnthropicRequest(
  request: ChatCompletionRequest,
  model: string,
  userId: string
): Promise<ChatCompletionResponse> {
  const startTime = Date.now();

  try {
    const client = getAnthropicClient();
    const anthropicRequest = transformToAnthropicFormat(request, model);

    logger.debug("Making Anthropic API request", { model, userId });

    const response = (await client.messages.create(
      anthropicRequest
    )) as Anthropic.Message;

    const duration = Date.now() - startTime;
    const totalTokens =
      response.usage.input_tokens + response.usage.output_tokens;

    logLLMRequest(userId, model, "anthropic", totalTokens, duration);

    const standardResponse = transformFromAnthropicFormat(
      response as unknown as AnthropicResponse,
      model
    );

    return standardResponse;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    logger.error("Anthropic API request failed", {
      error: error.message,
      model,
      userId,
      duration,
    });

    throw new ProviderError(
      error.message || "Anthropic API request failed",
      "anthropic",
      {
        statusCode: error.status,
        type: error.type,
      }
    );
  }
}

/**
 * Make a streaming request to Anthropic
 */
export async function* makeAnthropicStreamRequest(
  request: ChatCompletionRequest,
  model: string,
  userId: string
): AsyncGenerator<ChatCompletionChunk> {
  const startTime = Date.now();
  let totalTokens = 0;

  try {
    const client = getAnthropicClient();
    const anthropicRequest = transformToAnthropicFormat(request, model);
    anthropicRequest.stream = true;

    logger.debug("Making Anthropic streaming API request", { model, userId });

    const stream = await client.messages.stream(anthropicRequest);

    const messageId = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    // Yield chunks as they arrive
    for await (const event of stream) {
      if (event.type === "content_block_delta") {
        const delta = event.delta;
        if (delta.type === "text_delta") {
          yield {
            id: messageId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              {
                index: 0,
                delta: {
                  content: delta.text,
                },
                finish_reason: null,
              },
            ],
          };
        }
      } else if (event.type === "message_stop") {
        // Final chunk with finish reason
        yield {
          id: messageId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: "stop",
            },
          ],
        };
      }
    }

    const finalMessage = await stream.finalMessage();
    totalTokens =
      finalMessage.usage.input_tokens + finalMessage.usage.output_tokens;

    const duration = Date.now() - startTime;
    logLLMRequest(userId, model, "anthropic", totalTokens, duration);
  } catch (error: any) {
    const duration = Date.now() - startTime;
    logger.error("Anthropic streaming API request failed", {
      error: error.message,
      model,
      userId,
      duration,
    });

    throw new ProviderError(
      error.message || "Anthropic streaming API request failed",
      "anthropic",
      {
        statusCode: error.status,
        type: error.type,
      }
    );
  }
}

/**
 * Verify Anthropic API key is valid
 */
export async function verifyAnthropicConnection(): Promise<boolean> {
  try {
    const client = getAnthropicClient();

    // Make a simple request to verify the API key
    await client.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 1,
      messages: [{ role: "user", content: "Hi" }],
    });

    logger.info("Anthropic connection verified");
    return true;
  } catch (error: any) {
    logger.error("Anthropic connection verification failed", {
      error: error.message,
    });
    return false;
  }
}

export { getAnthropicClient };
