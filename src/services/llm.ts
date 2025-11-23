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

  return { client, apiModel, provider };
}

/**
 * Make a non-streaming request to any LLM provider
 * All providers use OpenAI SDK with appropriate client configuration
 */
export async function makeLLMRequest(
  request: ChatCompletionRequest,
  model: string,
  userId: string
): Promise<ChatCompletionResponse> {
  const startTime = Date.now();

  try {
    logger.debug("makeLLMRequest called", { model, userId });

    const { client, apiModel, provider } = getClientAndModel(model);

    logger.debug("Making LLM API request", {
      model,
      apiModel,
      provider,
      userId,
    });

    // Make request using OpenAI SDK
    // Pass through all parameters without constraints - let the SDK/API validate
    const response = await client.chat.completions.create({
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

    const duration = Date.now() - startTime;
    const totalTokens = response.usage?.total_tokens || 0;

    logLLMRequest(userId, model, provider, totalTokens, duration);

    logger.debug("LLM request completed", {
      model,
      provider,
      userId,
      duration,
      totalTokens,
    });

    // OpenAI SDK response is already in our standard format
    return response as ChatCompletionResponse;
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

    const { client, apiModel, provider } = getClientAndModel(model);

    logger.debug("Making LLM streaming API request", {
      model,
      apiModel,
      provider,
      userId,
    });

    // Make streaming request using OpenAI SDK
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

    const duration = Date.now() - startTime;
    logLLMRequest(userId, model, provider, totalTokens, duration);

    logger.debug("LLM streaming request completed", {
      model,
      provider,
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
