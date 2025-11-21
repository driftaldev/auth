// Gemini API service with request/response transformation

import { GoogleGenAI } from "@google/genai";
import { config } from "../config/index.js";
import { logger, logLLMRequest } from "../config/logger.js";
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  GeminiRequest,
  GeminiResponse,
  ProviderError,
  Message,
} from "../types/index.js";

// Initialize Gemini client
let geminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey: config.geminiApiKey,
    });
    logger.info("Gemini client initialized");
  }
  return geminiClient;
}

/**
 * Transform standard chat completion request to Gemini format
 */
function transformToGeminiFormat(
  request: ChatCompletionRequest,
  model: string
): GeminiRequest {
  // Extract system message (Gemini uses separate systemInstruction parameter)
  const systemMessages = request.messages.filter((m) => m.role === "system");
  const systemContent = systemMessages.map((m) => m.content).join("\n");

  // Filter out system messages and convert to Gemini format
  // Note: Gemini uses "model" instead of "assistant" for the assistant role
  const contents = request.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: m.content }],
    }));

  const geminiRequest: GeminiRequest = {
    contents,
    ...(systemContent && {
      systemInstruction: {
        parts: [{ text: systemContent }],
      },
    }),
    generationConfig: {
      ...(request.temperature !== undefined && {
        temperature: request.temperature,
      }),
      ...(request.max_tokens && { maxOutputTokens: request.max_tokens }),
      ...(request.top_p !== undefined && { topP: request.top_p }),
      ...(request.stop && {
        stopSequences: Array.isArray(request.stop)
          ? request.stop
          : [request.stop],
      }),
    },
  };

  return geminiRequest;
}

/**
 * Transform Gemini response to standard chat completion format
 */
function transformFromGeminiFormat(
  response: GeminiResponse,
  model: string
): ChatCompletionResponse {
  const candidate = response.candidates[0];
  const content = candidate.content.parts.map((part) => part.text).join("");

  return {
    id: `chatcmpl-${Date.now()}`,
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
        finish_reason: mapGeminiFinishReason(candidate.finishReason),
      },
    ],
    usage: {
      prompt_tokens: response.usageMetadata.promptTokenCount,
      completion_tokens: response.usageMetadata.candidatesTokenCount,
      total_tokens: response.usageMetadata.totalTokenCount,
    },
  };
}

/**
 * Map Gemini finish reason to standard format
 */
function mapGeminiFinishReason(
  finishReason: string
): "stop" | "length" | "content_filter" | null {
  switch (finishReason) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
      return "content_filter";
    default:
      return null;
  }
}

/**
 * Make a non-streaming request to Gemini
 */
export async function makeGeminiRequest(
  request: ChatCompletionRequest,
  model: string,
  userId: string
): Promise<ChatCompletionResponse> {
  const startTime = Date.now();

  try {
    const client = getGeminiClient();
    const geminiRequest = transformToGeminiFormat(request, model);

    logger.debug("Making Gemini API request", { model, userId });

    // Generate content
    const response = await client.models.generateContent({
      model,
      contents: geminiRequest.contents,
      ...(geminiRequest.systemInstruction && {
        config: {
          systemInstruction: geminiRequest.systemInstruction,
          ...geminiRequest.generationConfig,
        },
      }),
      ...(!geminiRequest.systemInstruction &&
        geminiRequest.generationConfig && {
          config: geminiRequest.generationConfig,
        }),
    });

    const duration = Date.now() - startTime;
    const totalTokens = response.usageMetadata?.totalTokenCount || 0;

    logLLMRequest(userId, model, "gemini", totalTokens, duration);

    const standardResponse = transformFromGeminiFormat(
      response as unknown as GeminiResponse,
      model
    );

    return standardResponse;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    logger.error("Gemini API request failed", {
      error: error.message,
      model,
      userId,
      duration,
    });

    throw new ProviderError(
      error.message || "Gemini API request failed",
      "gemini",
      {
        statusCode: error.status || error.statusCode,
        type: error.type || error.name,
      }
    );
  }
}

/**
 * Make a streaming request to Gemini
 */
export async function* makeGeminiStreamRequest(
  request: ChatCompletionRequest,
  model: string,
  userId: string
): AsyncGenerator<ChatCompletionChunk> {
  const startTime = Date.now();
  let totalTokens = 0;

  try {
    const client = getGeminiClient();
    const geminiRequest = transformToGeminiFormat(request, model);

    logger.debug("Making Gemini streaming API request", { model, userId });

    // Generate content stream
    const stream = await client.models.generateContentStream({
      model,
      contents: geminiRequest.contents,
      ...(geminiRequest.systemInstruction && {
        config: {
          systemInstruction: geminiRequest.systemInstruction,
          ...geminiRequest.generationConfig,
        },
      }),
      ...(!geminiRequest.systemInstruction &&
        geminiRequest.generationConfig && {
          config: geminiRequest.generationConfig,
        }),
    });

    const messageId = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    // Yield chunks as they arrive
    for await (const chunk of stream) {
      if (chunk.candidates && chunk.candidates[0]) {
        const candidate = chunk.candidates[0];
        const text = candidate.content?.parts?.[0]?.text;

        if (text) {
          yield {
            id: messageId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              {
                index: 0,
                delta: {
                  content: text,
                },
                finish_reason: null,
              },
            ],
          };
        }

        // Check if this is the final chunk
        if (
          candidate.finishReason &&
          candidate.finishReason !== "FINISH_REASON_UNSPECIFIED"
        ) {
          yield {
            id: messageId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: mapGeminiFinishReason(candidate.finishReason),
              },
            ],
          };
        }
      }

      // Track usage if available
      if (chunk.usageMetadata) {
        totalTokens = chunk.usageMetadata.totalTokenCount || 0;
      }
    }

    const duration = Date.now() - startTime;
    logLLMRequest(userId, model, "gemini", totalTokens, duration);
  } catch (error: any) {
    const duration = Date.now() - startTime;
    logger.error("Gemini streaming API request failed", {
      error: error.message,
      model,
      userId,
      duration,
    });

    throw new ProviderError(
      error.message || "Gemini streaming API request failed",
      "gemini",
      {
        statusCode: error.status || error.statusCode,
        type: error.type || error.name,
      }
    );
  }
}

/**
 * Verify Gemini API key is valid
 */
export async function verifyGeminiConnection(): Promise<boolean> {
  try {
    const client = getGeminiClient();

    // Make a simple request to verify the API key
    await client.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: [
        {
          role: "user",
          parts: [{ text: "Hi" }],
        },
      ],
      config: {
        maxOutputTokens: 1,
      },
    });

    logger.info("Gemini connection verified");
    return true;
  } catch (error: any) {
    logger.error("Gemini connection verification failed", {
      error: error.message,
    });
    return false;
  }
}

export { getGeminiClient };
