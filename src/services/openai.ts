// OpenAI API service with request/response transformation

import OpenAI from 'openai';
import { config } from '../config/index.js';
import { logger, logLLMRequest } from '../config/logger.js';
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ProviderError,
} from '../types/index.js';

// Initialize OpenAI client
let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: config.openaiApiKey,
    });
    logger.info('OpenAI client initialized');
  }
  return openaiClient;
}

/**
 * Make a non-streaming request to OpenAI
 * OpenAI format is already compatible with our standard format
 */
export async function makeOpenAIRequest(
  request: ChatCompletionRequest,
  model: string,
  userId: string
): Promise<ChatCompletionResponse> {
  const startTime = Date.now();

  try {
    const client = getOpenAIClient();

    logger.debug('Making OpenAI API request', { model, userId });

    const response = await client.chat.completions.create({
      model,
      messages: request.messages,
      ...(request.temperature !== undefined && { temperature: request.temperature }),
      ...(request.max_tokens && { max_tokens: request.max_tokens }),
      ...(request.top_p !== undefined && { top_p: request.top_p }),
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

    logLLMRequest(userId, model, 'openai', totalTokens, duration);

    // OpenAI response is already in our standard format
    return response as ChatCompletionResponse;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    logger.error('OpenAI API request failed', {
      error: error.message,
      model,
      userId,
      duration,
    });

    throw new ProviderError(
      error.message || 'OpenAI API request failed',
      'openai',
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
 */
export async function* makeOpenAIStreamRequest(
  request: ChatCompletionRequest,
  model: string,
  userId: string
): AsyncGenerator<ChatCompletionChunk> {
  const startTime = Date.now();
  let totalTokens = 0;

  try {
    const client = getOpenAIClient();

    logger.debug('Making OpenAI streaming API request', { model, userId });

    const stream = await client.chat.completions.create({
      model,
      messages: request.messages,
      ...(request.temperature !== undefined && { temperature: request.temperature }),
      ...(request.max_tokens && { max_tokens: request.max_tokens }),
      ...(request.top_p !== undefined && { top_p: request.top_p }),
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
    logLLMRequest(userId, model, 'openai', totalTokens, duration);
  } catch (error: any) {
    const duration = Date.now() - startTime;
    logger.error('OpenAI streaming API request failed', {
      error: error.message,
      model,
      userId,
      duration,
    });

    throw new ProviderError(
      error.message || 'OpenAI streaming API request failed',
      'openai',
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
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 1,
    });

    logger.info('OpenAI connection verified');
    return true;
  } catch (error: any) {
    logger.error('OpenAI connection verification failed', {
      error: error.message,
    });
    return false;
  }
}

export { getOpenAIClient };
