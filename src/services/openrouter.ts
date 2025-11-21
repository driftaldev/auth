// OpenRouter API service with request/response transformation

import { config } from "../config/index.js";
import { logger, logLLMRequest } from "../config/logger.js";
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ProviderError,
} from "../types/index.js";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// Type for OpenRouter API response
interface OpenRouterResponse {
  id?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Make a non-streaming request to OpenRouter
 */
export async function makeOpenRouterRequest(
  request: ChatCompletionRequest,
  model: string,
  userId: string
): Promise<ChatCompletionResponse> {
  const startTime = Date.now();

  try {
    logger.debug("Making OpenRouter API request", { model, userId });

    const apiKey = config.openrouterApiKey;
    if (!apiKey) {
      throw new Error("OpenRouter API key not configured");
    }

    // Make HTTP request to OpenRouter chat completions endpoint
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://driftal.dev", // Required by OpenRouter for attribution
        "X-Title": "Driftal", // Required by OpenRouter for attribution
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        ...(request.temperature !== undefined && {
          temperature: request.temperature,
        }),
        ...(request.max_tokens && { max_tokens: request.max_tokens }),
        ...(request.top_p !== undefined && { top_p: request.top_p }),
        ...(request.stop && { stop: request.stop }),
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `OpenRouter API request failed: ${response.statusText}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage =
          errorJson.error?.message || errorJson.error || errorMessage;
      } catch {
        // Use the raw error text if it's not JSON
        errorMessage = `OpenRouter API request failed: ${errorText}`;
      }

      logger.error("OpenRouter API request failed", {
        status: response.status,
        error: errorMessage,
      });

      throw new ProviderError(errorMessage, "openrouter", {
        status: response.status,
      });
    }

    const data = (await response.json()) as OpenRouterResponse;

    // Transform OpenRouter response to our standard format
    const chatResponse: ChatCompletionResponse = {
      id: data.id || `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: data.created || Math.floor(Date.now() / 1000),
      model: data.model || model,
      choices: (data.choices || []).map((choice) => ({
        index: choice.index,
        message: {
          role: choice.message.role as "assistant",
          content: choice.message.content,
        },
        finish_reason: choice.finish_reason as
          | "stop"
          | "length"
          | "content_filter"
          | null,
      })),
      usage: data.usage
        ? {
            prompt_tokens: data.usage.prompt_tokens,
            completion_tokens: data.usage.completion_tokens,
            total_tokens: data.usage.total_tokens,
          }
        : undefined,
    };

    const duration = Date.now() - startTime;

    // Log the request
    await logLLMRequest(
      userId,
      model,
      "openrouter",
      chatResponse.usage?.total_tokens || 0,
      duration
    );

    logger.info("OpenRouter request completed", {
      userId,
      model,
      duration,
      tokens: chatResponse.usage?.total_tokens,
    });

    return chatResponse;
  } catch (error: any) {
    const duration = Date.now() - startTime;

    // Log the failed request
    await logLLMRequest(userId, model, "openrouter", 0, duration);

    logger.error("OpenRouter request failed", {
      userId,
      model,
      duration,
      error: error.message,
    });

    if (error instanceof ProviderError) {
      throw error;
    }

    throw new ProviderError(
      error.message || "OpenRouter request failed",
      "openrouter",
      { status: 500 }
    );
  }
}

/**
 * Make a streaming request to OpenRouter
 */
export async function* makeOpenRouterStreamRequest(
  request: ChatCompletionRequest,
  model: string,
  userId: string
): AsyncGenerator<ChatCompletionChunk> {
  const startTime = Date.now();
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;

  try {
    logger.debug("Making OpenRouter streaming API request", { model, userId });

    const apiKey = config.openrouterApiKey;
    if (!apiKey) {
      throw new Error("OpenRouter API key not configured");
    }

    // Make HTTP request to OpenRouter chat completions endpoint with streaming
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://scoutlab.ai", // Required by OpenRouter for attribution
        "X-Title": "ScoutLab", // Required by OpenRouter for attribution
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        ...(request.temperature !== undefined && {
          temperature: request.temperature,
        }),
        ...(request.max_tokens && { max_tokens: request.max_tokens }),
        ...(request.top_p !== undefined && { top_p: request.top_p }),
        ...(request.stop && { stop: request.stop }),
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `OpenRouter API request failed: ${response.statusText}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage =
          errorJson.error?.message || errorJson.error || errorMessage;
      } catch {
        errorMessage = `OpenRouter API request failed: ${errorText}`;
      }

      logger.error("OpenRouter streaming API request failed", {
        status: response.status,
        error: errorMessage,
      });

      throw new ProviderError(errorMessage, "openrouter", {
        status: response.status,
      });
    }

    if (!response.body) {
      throw new ProviderError(
        "No response body received from OpenRouter",
        "openrouter",
        { status: 500 }
      );
    }

    const messageId = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    // Read the stream and parse SSE chunks
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep the last incomplete line in the buffer

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") {
              continue;
            }

            try {
              const parsed = JSON.parse(data);

              // Track usage if available
              if (parsed.usage) {
                totalPromptTokens = parsed.usage.prompt_tokens || 0;
                totalCompletionTokens = parsed.usage.completion_tokens || 0;
                totalTokens = parsed.usage.total_tokens || 0;
              }

              // Yield the chunk in our standard format
              if (parsed.choices && parsed.choices.length > 0) {
                const choice = parsed.choices[0];
                yield {
                  id: parsed.id || messageId,
                  object: "chat.completion.chunk",
                  created: parsed.created || created,
                  model: parsed.model || model,
                  choices: [
                    {
                      index: choice.index || 0,
                      delta: {
                        role: choice.delta?.role,
                        content: choice.delta?.content,
                      },
                      finish_reason: choice.finish_reason || null,
                    },
                  ],
                };
              }
            } catch (e) {
              logger.error("Failed to parse OpenRouter SSE chunk", {
                error: e,
                data,
              });
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const duration = Date.now() - startTime;

    // Log the streaming request
    await logLLMRequest(userId, model, "openrouter", totalTokens, duration);

    logger.info("OpenRouter stream completed", {
      userId,
      model,
      duration,
      tokens: totalTokens,
    });
  } catch (error: any) {
    const duration = Date.now() - startTime;

    // Log the failed request
    await logLLMRequest(userId, model, "openrouter", 0, duration);

    logger.error("OpenRouter streaming request failed", {
      userId,
      model,
      duration,
      error: error.message,
    });

    if (error instanceof ProviderError) {
      throw error;
    }

    throw new ProviderError(
      error.message || "OpenRouter streaming request failed",
      "openrouter",
      { status: 500 }
    );
  }
}
