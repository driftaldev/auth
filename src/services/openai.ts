// OpenAI API service with request/response transformation

import OpenAI from "openai";
import { config } from "../config/index.js";
import { logger, logLLMRequest } from "../config/logger.js";
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ProviderError,
} from "../types/index.js";
import { getEndpointType, applyParameterConstraints } from "./model-config.js";
import { OpenAI } from "openai";

// Type for OpenAI /v1/responses endpoint response
interface OpenAIResponsesResponse {
  id?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    message?: {
      content: string;
    };
    content?: string;
    finish_reason?: string;
  }>;
  content?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

// Initialize OpenAI client
let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: config.openaiApiKey });
    logger.info("OpenAI client initialized");
  }
  return openaiClient;
}

async function makeOpenAIResponsesRequest(
  request: ChatCompletionRequest,
  model: string,
  userId: string
): Promise<ChatCompletionResponse> {
  const startTime = Date.now();

  try {
    console.log("Making OpenAI responses API request", {
      request,
      model,
      userId,
    });
    logger.debug("Making OpenAI responses API request", { model, userId });

    const apiKey = config.openaiApiKey;
    if (!apiKey) {
      throw new Error("OpenAI API key not configured");
    }

    // Make direct HTTP request to v1/responses endpoint
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
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
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `OpenAI API request failed: ${response.statusText}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage =
          errorJson.error?.message || errorJson.error || errorMessage;
      } catch {
        errorMessage = errorText || errorMessage;
      }
      throw new Error(errorMessage);
    }

    const responseText = await response.text();
    let responseData: OpenAIResponsesResponse;

    try {
      responseData = JSON.parse(responseText) as OpenAIResponsesResponse;
    } catch (parseError) {
      logger.error("Failed to parse OpenAI responses API response", {
        responseText,
        model,
        userId,
      });
      throw new Error(
        `Invalid JSON response from OpenAI: ${responseText.substring(0, 200)}`
      );
    }

    // Check if response contains an error (even if HTTP status is 200)
    if ((responseData as any).error) {
      const errorMsg =
        (responseData as any).error?.message ||
        (responseData as any).error ||
        "Unknown error";
      logger.error("OpenAI responses API returned error in response body", {
        error: errorMsg,
        model,
        userId,
        responseData,
      });
      throw new Error(`OpenAI API error: ${errorMsg}`);
    }

    logger.debug("OpenAI responses API response", {
      model,
      userId,
      hasChoices: !!responseData.choices,
      choicesLength: responseData.choices?.length,
      hasContent: !!responseData.content,
    });

    const duration = Date.now() - startTime;
    const totalTokens = responseData.usage?.total_tokens || 0;

    logLLMRequest(userId, model, "openai", totalTokens, duration);

    // Transform responses format to chat completions format
    // The responses endpoint returns a different structure, so we need to adapt it
    const choices =
      responseData.choices &&
      Array.isArray(responseData.choices) &&
      responseData.choices.length > 0
        ? responseData.choices.map((choice: any, index: number) => ({
            index,
            message: {
              role: "assistant",
              content: choice.message?.content || choice.content || "",
            },
            finish_reason: choice.finish_reason || "stop",
          }))
        : responseData.content
        ? [
            {
              index: 0,
              message: {
                role: "assistant",
                content: responseData.content,
              },
              finish_reason: "stop",
            },
          ]
        : [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "",
              },
              finish_reason: "stop",
            },
          ];

    return {
      id: responseData.id || `resp-${Date.now()}`,
      object: "chat.completion",
      created: responseData.created || Math.floor(Date.now() / 1000),
      model: responseData.model || model,
      choices,
      usage: responseData.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    } as ChatCompletionResponse;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    logger.error("OpenAI responses API request failed", {
      error: error.message,
      model,
      userId,
      duration,
    });

    throw new ProviderError(
      error.message || "OpenAI responses API request failed",
      "openai",
      {
        statusCode: error.status || error.statusCode || 500,
        code: error.code,
        type: error.type,
      }
    );
  }
}

/**
 * Make a non-streaming request to OpenAI
 * Routes to appropriate endpoint (chat/completions or responses) based on model config
 * Applies parameter constraints before making request
 */
export async function makeOpenAIRequest(
  request: ChatCompletionRequest,
  model: string,
  userId: string
): Promise<ChatCompletionResponse> {
  const startTime = Date.now();

  try {
    logger.debug("makeOpenAIRequest called", { model, userId });

    // Apply parameter constraints based on model configuration
    const constrainedRequest = applyParameterConstraints(request, model);

    // Determine which endpoint to use
    const endpointType = getEndpointType(model);
    logger.debug("Endpoint type determined", { model, endpointType });

    if (endpointType === "responses") {
      logger.debug("Using responses endpoint", { model });
      return await makeOpenAIResponsesRequest(
        constrainedRequest,
        model,
        userId
      );
    }

    // Default to chat/completions endpoint
    logger.debug("Using chat/completions endpoint, initializing client", {
      model,
    });
    const client = getOpenAIClient();

    logger.debug("Making OpenAI API request", {
      model,
      userId,
      endpoint: "chat/completions",
    });

    const response = await client.chat.completions.create({
      model,
      messages: constrainedRequest.messages,
      ...(constrainedRequest.temperature !== undefined && {
        temperature: constrainedRequest.temperature,
      }),
      ...(constrainedRequest.max_tokens && {
        max_tokens: constrainedRequest.max_tokens,
      }),
      ...(constrainedRequest.top_p !== undefined && {
        top_p: constrainedRequest.top_p,
      }),
      ...(constrainedRequest.frequency_penalty !== undefined && {
        frequency_penalty: constrainedRequest.frequency_penalty,
      }),
      ...(constrainedRequest.presence_penalty !== undefined && {
        presence_penalty: constrainedRequest.presence_penalty,
      }),
      ...(constrainedRequest.stop && { stop: constrainedRequest.stop }),
      stream: false,
    });

    const duration = Date.now() - startTime;
    const totalTokens = response.usage?.total_tokens || 0;

    logLLMRequest(userId, model, "openai", totalTokens, duration);

    // OpenAI response is already in our standard format
    return response as ChatCompletionResponse;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    logger.error("OpenAI API request failed", {
      error: error.message,
      model,
      userId,
      duration,
    });

    throw new ProviderError(
      error.message || "OpenAI API request failed",
      "openai",
      {
        statusCode: error.status,
        code: error.code,
        type: error.type,
      }
    );
  }
}

/**
 * Make a streaming request to OpenAI
 * Routes to appropriate endpoint and applies parameter constraints
 */
export async function* makeOpenAIStreamRequest(
  request: ChatCompletionRequest,
  model: string,
  userId: string
): AsyncGenerator<ChatCompletionChunk> {
  const startTime = Date.now();
  let totalTokens = 0;

  try {
    // Apply parameter constraints based on model configuration
    const constrainedRequest = applyParameterConstraints(request, model);

    // Determine which endpoint to use
    const endpointType = getEndpointType(model);

    // Note: Responses endpoint may not support streaming
    // For now, we'll attempt streaming on chat/completions only
    if (endpointType === "responses") {
      logger.warn(
        "Streaming not supported for responses endpoint, falling back to non-streaming",
        { model }
      );
      // For responses endpoint, we'd need to handle differently
      // For now, throw an error indicating streaming isn't supported
      throw new ProviderError(
        "Streaming is not supported for models using the responses endpoint",
        "openai",
        { statusCode: 400 }
      );
    }

    const client = getOpenAIClient();

    logger.debug("Making OpenAI streaming API request", {
      model,
      userId,
      endpoint: "chat/completions",
    });

    const stream = await client.chat.completions.create({
      model,
      messages: constrainedRequest.messages,
      ...(constrainedRequest.temperature !== undefined && {
        temperature: constrainedRequest.temperature,
      }),
      ...(constrainedRequest.max_tokens && {
        max_tokens: constrainedRequest.max_tokens,
      }),
      ...(constrainedRequest.top_p !== undefined && {
        top_p: constrainedRequest.top_p,
      }),
      ...(constrainedRequest.frequency_penalty !== undefined && {
        frequency_penalty: constrainedRequest.frequency_penalty,
      }),
      ...(constrainedRequest.presence_penalty !== undefined && {
        presence_penalty: constrainedRequest.presence_penalty,
      }),
      ...(constrainedRequest.stop && { stop: constrainedRequest.stop }),
      stream: true,
      stream_options: { include_usage: true },
    });

    // Stream chunks to client
    for await (const chunk of stream) {
      // Track token usage from final chunk
      if (chunk.usage) {
        totalTokens = chunk.usage.total_tokens;
      }

      yield chunk as ChatCompletionChunk;
    }

    const duration = Date.now() - startTime;
    logLLMRequest(userId, model, "openai", totalTokens, duration);
  } catch (error: any) {
    const duration = Date.now() - startTime;
    logger.error("OpenAI streaming API request failed", {
      error: error.message,
      model,
      userId,
      duration,
    });

    throw new ProviderError(
      error.message || "OpenAI streaming API request failed",
      "openai",
      {
        statusCode: error.status,
        code: error.code,
        type: error.type,
      }
    );
  }
}

/**
 * Verify OpenAI API key is valid
 */
export async function verifyOpenAIConnection(): Promise<boolean> {
  try {
    const client = getOpenAIClient();

    // Make a simple request to verify the API key
    await client.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1,
    });

    logger.info("OpenAI connection verified");
    return true;
  } catch (error: any) {
    logger.error("OpenAI connection verification failed", {
      error: error.message,
    });
    return false;
  }
}

export { getOpenAIClient };
