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
  modelInfo: (typeof SUPPORTED_MODELS)[string];
} {
  const modelInfo = SUPPORTED_MODELS[modelId];
  if (!modelInfo) {
    throw new Error(`Unsupported model: ${modelId}`);
  }

  const clients = getClients();
  const provider = modelInfo.provider;

  const apiModel = modelInfo.openRouterId || modelId;

  // Map provider to client
  let client: OpenAI;
  if (provider === "openai") {
    client = clients.openai;
  } else if (provider === "google" || provider === "anthropic") {
    // Route all non-OpenAI providers through OpenRouter
    client = clients.openrouter;
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  return { client, apiModel, provider, modelInfo };
}
function sanitizeTools(tools: any[] | undefined): any[] | undefined {
  if (!tools || !Array.isArray(tools)) {
    logger.debug("No tools to sanitize");
    return undefined;
  }

  return tools.map((tool, index) => {
    logger.debug(`Processing tool ${index}:`, tool);

    if (
      tool.type === "function" &&
      tool.function &&
      tool.function.name &&
      tool.name
    ) {
      logger.debug(`Tool ${index} already properly formatted`);
      return tool;
    }

    let toolName = tool.name || tool.function?.name || tool.id;

    if (!toolName) {
      toolName = `tool_${index}`;
      logger.warn(
        `Tool at index ${index} has no identifiable name, using fallback: ${toolName}`
      );
    }

    if (!tool.function) {
      tool.function = {
        name: toolName,
        description: tool.description || "",
        parameters: tool.parameters || tool.inputSchema || {},
        type: "function",
      };
      logger.debug(`Created function object for tool ${toolName}`);
    }

    if (!tool.function.name) {
      tool.function.name = toolName;
    }
    if (!tool.function.type) {
      tool.function.type = "function";
    }

    tool.type = "function";
    tool.name = toolName;

    logger.debug("Sanitized tool", {
      name: toolName,
      hasFunction: !!tool.function,
      hasParameters: !!tool.function.parameters,
      sanitized: tool,
    });
    return tool;
  });
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
    // ...(request.temperature !== undefined && {
    //   temperature: request.temperature,
    // }),
    ...(request.max_tokens && {
      max_output_tokens: request.max_tokens,
    }),
    ...(request.top_p !== undefined && {
      top_p: request.top_p,
    }),
    ...(request.stop && { stop: request.stop }),
    ...(request.tools && { tools: request.tools }),
    ...(request.tool_choice && { tool_choice: request.tool_choice }),
    // Add default reasoning config for reasoning models
    reasoning: {
      effort: "medium" as const,
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
  // The Responses API returns output as an array with different types (reasoning, message, etc.)
  // We need to find the message type with actual content
  let outputText = "";

  if (response.output_text) {
    // Direct output_text field
    outputText = response.output_text;
  } else if (response.output && Array.isArray(response.output)) {
    // Find message type in output array
    const messageOutput = response.output.find(
      (item: any) => item.type === "message"
    );
    if (messageOutput?.content && Array.isArray(messageOutput.content)) {
      // Extract text from content array
      const textContent = messageOutput.content.find(
        (c: any) => c.type === "output_text"
      );
      outputText = textContent?.text || "";
    }
  }

  // Transform usage to match Chat Completions format
  const usage = response.usage
    ? {
        prompt_tokens: response.usage.input_tokens || 0,
        completion_tokens: response.usage.output_tokens || 0,
        total_tokens: response.usage.total_tokens || 0,
      }
    : {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      };

  return {
    id: response.id || `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: response.created_at || Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: outputText,
        },
        finish_reason: response.status === "completed" ? "stop" : "length",
      },
    ],
    usage,
  };
}

/**
 * Transform OpenAI Responses API stream chunk to ChatCompletionChunk format
 */
function transformResponsesStreamChunk(
  chunk: any,
  modelId: string,
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null
): ChatCompletionChunk | null {
  // Responses API streams events, not just deltas
  // We need to extract content from different event types

  let content = "";
  let reasoning = "";
  let finishReason = null;
  let role: "assistant" | undefined = undefined;

  // Handle response.output_text.delta events (regular text output)
  if (chunk.type === "response.output_text.delta" && chunk.delta) {
    content = chunk.delta;
  }
  // Handle content_block_delta events
  else if (chunk.type === "content_block_delta" && chunk.delta?.text) {
    content = chunk.delta.text;
  }
  // Handle message_delta events
  else if (chunk.type === "message_delta" && chunk.delta?.content) {
    content = chunk.delta.content;
  }
  // Handle reasoning/thinking events from reasoning models (o1, o3, etc.)
  else if (
    chunk.type === "response.reasoning.delta" ||
    chunk.type === "response.reasoning_summary.delta" ||
    chunk.type === "reasoning.delta" ||
    chunk.type === "reasoning" ||
    chunk.type === "response.thinking.delta" ||
    chunk.type === "thinking.delta"
  ) {
    reasoning = chunk.delta || chunk.text || chunk.content || "";
    logger.debug("Captured reasoning chunk", {
      type: chunk.type,
      reasoningLength: reasoning.length,
    });
  }
  // Handle response.done/completed events
  else if (
    chunk.type === "response.done" ||
    chunk.type === "response.completed" ||
    chunk.event === "done"
  ) {
    finishReason = "stop";
  }
  // Skip truly irrelevant events
  else {
    return null;
  }

  // Only return a chunk if we have content, reasoning, finish event, or usage
  if (!content && !reasoning && !finishReason && !usage) {
    return null;
  }

  const transformedChunk: ChatCompletionChunk = {
    id: chunk.id || `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: chunk.created || Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [
      {
        index: 0,
        delta: {
          role,
          content: content || undefined,
          reasoning: reasoning || undefined,
        },
        finish_reason: finishReason,
      },
    ],
  };

  // Include usage if provided (typically only in final chunk)
  if (usage) {
    transformedChunk.usage = usage;
  }

  return transformedChunk;
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

    // Sanitize tools if present
    if (request.tools) {
      // request.tools = sanitizeTools(request.tools);
      request.tools = []; //disable tools for now
    }

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

      logger.info("Raw response of responses api", rawResponse);

      response = transformFromResponsesAPI(rawResponse, model);

      logger.info("Transformed response", {
        hasChoices: !!response.choices,
        choicesLength: response.choices?.length,
        contentLength: response.choices?.[0]?.message?.content?.length,
        contentPreview: response.choices?.[0]?.message?.content?.substring(
          0,
          100
        ),
        usage: response.usage,
      });
    } else {
      // Use Chat Completions API for standard models
      logger.debug("Using Chat Completions API", { model: apiModel });

      const chatResponse = await client.chat.completions.create({
        model: apiModel,
        messages: request.messages,
        // ...(request.temperature !== undefined && {
        //   temperature: request.temperature,
        // }),
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
        ...(request.tools && { tools: request.tools }),
        ...(request.tool_choice && { tool_choice: request.tool_choice }),
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

    // Sanitize tools if present
    if (request.tools) {
      // request.tools = sanitizeTools(request.tools);
      request.tools = []; //disable tools for now
    }

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

      logger.info("Responses API stream created, starting to process events");

      // Stream chunks to client, transforming to chat completion format
      let lastResponseObject: any = null;
      let eventCount = 0;
      for await (const chunk of stream as any) {
        eventCount++;
        logger.debug(`Responses API event ${eventCount}`, {
          type: chunk.type,
          event: chunk.event,
          hasDelta: !!chunk.delta,
          hasUsage: !!chunk.usage,
        });

        // Capture response.completed event
        if (chunk.type === "response.completed" || chunk.event === "done") {
          lastResponseObject = chunk;
          logger.debug("Captured response.completed event", {
            hasResponse: !!chunk.response,
            hasUsage: !!chunk.response?.usage,
          });
        }

        // Track token usage from event-level usage field (if available)
        if (chunk.usage) {
          totalTokens = chunk.usage.total_tokens;
          logger.debug("Captured usage from event", { totalTokens });
        }

        // Extract usage for final chunk
        let usageToInclude = null;
        if (
          (chunk.type === "response.completed" || chunk.event === "done") &&
          lastResponseObject?.response?.usage
        ) {
          usageToInclude = {
            prompt_tokens:
              lastResponseObject.response.usage.input_tokens || 0,
            completion_tokens:
              lastResponseObject.response.usage.output_tokens || 0,
            total_tokens:
              lastResponseObject.response.usage.total_tokens || 0,
          };
          totalTokens = usageToInclude.total_tokens;
          logger.info(
            "✅ Extracted usage from response.completed",
            usageToInclude
          );
        }

        // Transform and yield chunk (skip null chunks like reasoning events)
        const transformedChunk = transformResponsesStreamChunk(
          chunk,
          model,
          usageToInclude
        );
        if (transformedChunk) {
          logger.debug(`Transformed chunk ${eventCount}`, {
            contentLength:
              transformedChunk.choices?.[0]?.delta?.content?.length,
            finishReason: transformedChunk.choices?.[0]?.finish_reason,
            hasUsage: !!transformedChunk.usage,
          });
          yield transformedChunk;
        } else {
          logger.debug(`Skipped event ${eventCount} (null transformation)`);
        }
      }

      logger.info(
        `Responses API stream complete: ${eventCount} events processed, totalTokens: ${totalTokens}`
      );
    } else {
      // Use Chat Completions API for standard models
      logger.debug("Using Chat Completions API (streaming)", {
        model: apiModel,
      });

      const stream = await client.chat.completions.create({
        model: apiModel,
        messages: request.messages,
        // ...(request.temperature !== undefined && {
        //   temperature: request.temperature,
        // }),
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
        ...(request.tools && { tools: request.tools }),
        ...(request.tool_choice && { tool_choice: request.tool_choice }),
        stream: true,
        stream_options: { include_usage: true },
      });

      // Stream chunks to client
      for await (const chunk of stream) {
        // Track token usage from final chunk
        logger.info(`✅ [LLM Service] Received chunk:`, {
          chunk,
        });
        if (chunk.usage) {
          totalTokens = chunk.usage.total_tokens;
          logger.info(`✅ [LLM Service] Received usage from OpenAI:`, {
            prompt_tokens: chunk.usage.prompt_tokens,
            completion_tokens: chunk.usage.completion_tokens,
            total_tokens: chunk.usage.total_tokens,
          });
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
