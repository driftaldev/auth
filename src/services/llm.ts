import OpenAI from "openai";
import { config } from "../config/index.js";
import { logger, logLLMRequest } from "../config/logger.js";
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ProviderError,
  SUPPORTED_MODELS,
  LLMProvider,
} from "../types/index.js";

// OpenAI SDK clients for different providers
interface LLMClients {
  openai: OpenAI;
  openrouter: OpenAI;
}

let clients: LLMClients | null = null;

/**
 * Initialize OpenAI SDK clients for all providers
 */
function getClients(): LLMClients {
  if (!clients) {
    clients = {
      // Direct OpenAI client
      openai: new OpenAI({ apiKey: config.openaiApiKey }),
      // OpenRouter client (OpenAI-compatible API)
      openrouter: new OpenAI({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: "https://openrouter.ai/api/v1",
      }),
    };
    logger.info("LLM clients initialized", {
      providers: Object.keys(clients),
    });
  }
  return clients;
}

/**
 * Get the appropriate client and model name for a given model ID
 */
function getClientAndModel(modelId: string): {
  client: OpenAI;
  apiModel: string;
  provider: LLMProvider;
  modelInfo: typeof SUPPORTED_MODELS[string];
} {
  const modelInfo = SUPPORTED_MODELS[modelId];
  if (!modelInfo) {
    throw new Error(`Unsupported model: ${modelId}`);
  }

  const clients = getClients();
  const provider = modelInfo.provider;

  const apiModel = modelId;

  // Map provider to client
  let client: OpenAI;
  if (provider === "openai") {
    client = clients.openai;
  } else if (
    provider === "openrouter" ||
    provider === "gemini" ||
    provider === "anthropic"
  ) {
    // Route all non-OpenAI providers through OpenRouter
    client = clients.openrouter;
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  return { client, apiModel, provider, modelInfo };
}

/**
 * Transform ChatCompletionRequest to OpenAI Responses API format
 */
function transformToResponsesAPI(request: ChatCompletionRequest) {
  // Convert messages array to input format
  // For simplicity, we'll use the message array format which is compatible
  const input = request.messages.map((msg) => ({
    type: "message" as const,
    role: msg.role === "system" ? ("user" as const) : msg.role,
    content: msg.content,
  }));

  return {
    input,
    ...(request.temperature !== undefined && {
      temperature: request.temperature,
    }),
    ...(request.max_tokens && {
      max_output_tokens: request.max_tokens,
    }),
    ...(request.top_p !== undefined && {
      top_p: request.top_p,
    }),
    ...(request.stop && { stop: request.stop }),
    // Add default reasoning config for reasoning models
    reasoning: {
      type: "medium" as const,
    },
  };
}

/**
 * Transform OpenAI Responses API response to ChatCompletionResponse format
 */
function transformFromResponsesAPI(
  response: any,
  modelId: string
): ChatCompletionResponse {
  // Extract the text content from output
  const outputText =
    response.output_text || response.output?.[0]?.content || "";

  return {
    id: response.id || `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: response.created || Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: outputText,
        },
        finish_reason: response.finish_reason || "stop",
      },
    ],
    usage: response.usage || {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}

/**
 * Transform OpenAI Responses API stream chunk to ChatCompletionChunk format
 */
function transformResponsesStreamChunk(chunk: any, modelId: string): ChatCompletionChunk {
  // Handle different chunk formats from Responses API
  const content = chunk.delta?.content || chunk.content || "";

  return {
    id: chunk.id || `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: chunk.created || Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [
      {
        index: 0,
        delta: {
          role: chunk.delta?.role || undefined,
          content: content,
        },
        finish_reason: chunk.finish_reason || null,
      },
    ],
  };
}

/**
 * Make a non-streaming request to any LLM provider
 * All providers use OpenAI SDK with appropriate client configuration
 * Supports both Chat Completions and Responses API based on model type
 */
export async function makeLLMRequest(
  request: ChatCompletionRequest,
  model: string,
  userId: string
): Promise<ChatCompletionResponse> {
  const startTime = Date.now();

  try {
    logger.debug("makeLLMRequest called", { model, userId });

    const { client, apiModel, provider, modelInfo } = getClientAndModel(model);

    logger.debug("Making LLM API request", {
      model,
      apiModel,
      provider,
      apiType: modelInfo.apiType,
      userId,
    });

    let response: ChatCompletionResponse;

    if (modelInfo.apiType === "responses") {
      // Use Responses API for reasoning models
      const responsesRequest = transformToResponsesAPI(request);

      logger.debug("Using Responses API", {
        model: apiModel,
        inputType: typeof responsesRequest.input,
      });

      const rawResponse = await client.responses.create({
        model: apiModel,
        ...responsesRequest,
      } as any);

      // Transform response back to chat completions format
      response = transformFromResponsesAPI(rawResponse, model);
    } else {
      // Use Chat Completions API for standard models
      logger.debug("Using Chat Completions API", { model: apiModel });

      const chatResponse = await client.chat.completions.create({
        model: apiModel,
        messages: request.messages,
        ...(request.temperature !== undefined && {
          temperature: request.temperature,
        }),
        ...(request.max_tokens && {
          max_tokens: request.max_tokens,
        }),
        ...(request.top_p !== undefined && {
          top_p: request.top_p,
        }),
        ...(request.frequency_penalty !== undefined && {
          frequency_penalty: request.frequency_penalty,
        }),
        ...(request.presence_penalty !== undefined && {
          presence_penalty: request.presence_penalty,
        }),
        ...(request.stop && { stop: request.stop }),
        stream: false,
      });

      response = chatResponse as ChatCompletionResponse;
    }

    const duration = Date.now() - startTime;
    const totalTokens = response.usage?.total_tokens || 0;

    logLLMRequest(userId, model, provider, totalTokens, duration);

    logger.debug("LLM request completed", {
      model,
      provider,
      apiType: modelInfo.apiType,
      userId,
      duration,
      totalTokens,
    });

    return response;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    logger.error("LLM API request failed", {
      error: error.message,
      model,
      userId,
      duration,
    });

    // Extract provider from model (fallback to error handling)
    let provider: LLMProvider = "openai";
    try {
      const modelInfo = SUPPORTED_MODELS[model];
      if (modelInfo) {
        provider = modelInfo.provider;
      }
    } catch {}

    throw new ProviderError(
      error.message || "LLM API request failed",
      provider,
      {
        statusCode: error.status || error.statusCode || 500,
        code: error.code,
        type: error.type,
      }
    );
  }
}

/**
 * Make a streaming request to any LLM provider
 * All providers use OpenAI SDK with appropriate client configuration
 * Supports both Chat Completions and Responses API based on model type
 */
export async function* makeLLMStreamRequest(
  request: ChatCompletionRequest,
  model: string,
  userId: string
): AsyncGenerator<ChatCompletionChunk> {
  const startTime = Date.now();
  let totalTokens = 0;

  try {
    logger.debug("makeLLMStreamRequest called", { model, userId });

    const { client, apiModel, provider, modelInfo } = getClientAndModel(model);

    logger.debug("Making LLM streaming API request", {
      model,
      apiModel,
      provider,
      apiType: modelInfo.apiType,
      userId,
    });

    if (modelInfo.apiType === "responses") {
      // Use Responses API for reasoning models
      const responsesRequest = transformToResponsesAPI(request);

      logger.debug("Using Responses API (streaming)", {
        model: apiModel,
        inputType: typeof responsesRequest.input,
      });

      const stream = await client.responses.create({
        model: apiModel,
        ...responsesRequest,
        stream: true,
      } as any);

      // Stream chunks to client, transforming to chat completion format
      for await (const chunk of stream as any) {
        // Track token usage if available
        if (chunk.usage) {
          totalTokens = chunk.usage.total_tokens;
        }

        // Transform and yield chunk
        const transformedChunk = transformResponsesStreamChunk(chunk, model);
        yield transformedChunk;
      }
    } else {
      // Use Chat Completions API for standard models
      logger.debug("Using Chat Completions API (streaming)", { model: apiModel });

      const stream = await client.chat.completions.create({
        model: apiModel,
        messages: request.messages,
        ...(request.temperature !== undefined && {
          temperature: request.temperature,
        }),
        ...(request.max_tokens && {
          max_tokens: request.max_tokens,
        }),
        ...(request.top_p !== undefined && {
          top_p: request.top_p,
        }),
        ...(request.frequency_penalty !== undefined && {
          frequency_penalty: request.frequency_penalty,
        }),
        ...(request.presence_penalty !== undefined && {
          presence_penalty: request.presence_penalty,
        }),
        ...(request.stop && { stop: request.stop }),
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
    }

    const duration = Date.now() - startTime;
    logLLMRequest(userId, model, provider, totalTokens, duration);

    logger.debug("LLM streaming request completed", {
      model,
      provider,
      apiType: modelInfo.apiType,
      userId,
      duration,
      totalTokens,
    });
  } catch (error: any) {
    const duration = Date.now() - startTime;
    logger.error("LLM streaming API request failed", {
      error: error.message,
      model,
      userId,
      duration,
    });

    // Extract provider from model (fallback to error handling)
    let provider: LLMProvider = "openai";
    try {
      const modelInfo = SUPPORTED_MODELS[model];
      if (modelInfo) {
        provider = modelInfo.provider;
      }
    } catch {}

    throw new ProviderError(
      error.message || "LLM streaming API request failed",
      provider,
      {
        statusCode: error.status || error.statusCode || 500,
        code: error.code,
        type: error.type,
      }
    );
  }
}

export { getClients };
