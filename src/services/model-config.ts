// Model-specific configuration for OpenAI models
// Handles different endpoint requirements and parameter constraints

import type { ChatCompletionRequest } from "../types/index.js";

export type EndpointType = "chat/completions" | "responses";

export interface ParameterConstraint {
  min?: number;
  max?: number;
  default?: number;
  allowed?: number[];
  disallowed?: number[];
  remove?: boolean; // If true, remove this parameter from the request
}

export interface ModelConfig {
  endpoint: EndpointType;
  parameterConstraints: {
    temperature?: ParameterConstraint;
    top_p?: ParameterConstraint;
    max_tokens?: ParameterConstraint;
    [key: string]: ParameterConstraint | undefined;
  };
}

/**
 * Model-specific configurations
 * Maps actual OpenAI API model names to their requirements
 */
export const MODEL_CONFIGS: Record<string, ModelConfig> = {
  // Models that require v1/responses endpoint
  "gpt-5-codex": {
    endpoint: "responses",
    parameterConstraints: {},
  },
  "gpt-5-mini": {
    endpoint: "responses",
    parameterConstraints: {},
  },
  // Note: gpt-5.1-codex maps to gpt-5-codex, so it will use responses endpoint
  // Note: gpt-5.1-codex-mini maps to gpt-5-mini, so it will use responses endpoint

  // Models that use standard chat/completions but don't support temperature parameter
  "o4-mini": {
    endpoint: "chat/completions",
    parameterConstraints: {
      temperature: {
        remove: true, // Don't pass temperature parameter at all
      },
    },
  },
  o3: {
    endpoint: "chat/completions",
    parameterConstraints: {
      temperature: {
        remove: true, // Don't pass temperature parameter at all
      },
    },
  },

  // Default config for models not explicitly configured
  // Uses standard chat/completions endpoint with no constraints
};

/**
 * Get model configuration for a given model ID
 * Returns null if model is not configured (will use defaults)
 */
export function getModelConfig(modelId: string): ModelConfig | null {
  return MODEL_CONFIGS[modelId] || null;
}

/**
 * Apply parameter constraints to a request based on model configuration
 * Returns a new request object with constraints applied
 */
export function applyParameterConstraints(
  request: ChatCompletionRequest,
  modelId: string
): ChatCompletionRequest {
  const config = getModelConfig(modelId);

  if (!config) {
    return request;
  }

  const constraints = config.parameterConstraints;
  const updatedRequest = { ...request };

  // Apply temperature constraints
  if (constraints.temperature) {
    const tempConstraint = constraints.temperature;

    // If remove flag is set, just delete temperature parameter
    if (tempConstraint.remove === true) {
      delete updatedRequest.temperature;
    } else {
      // Otherwise, apply other constraints if needed
      if (
        updatedRequest.temperature !== undefined &&
        tempConstraint.disallowed?.includes(updatedRequest.temperature)
      ) {
        if (tempConstraint.default !== undefined) {
          updatedRequest.temperature = tempConstraint.default;
        } else {
          delete updatedRequest.temperature;
        }
      }

      // Apply min/max constraints
      if (updatedRequest.temperature !== undefined) {
        if (
          tempConstraint.min !== undefined &&
          updatedRequest.temperature < tempConstraint.min
        ) {
          updatedRequest.temperature = tempConstraint.min;
        }
        if (
          tempConstraint.max !== undefined &&
          updatedRequest.temperature > tempConstraint.max
        ) {
          updatedRequest.temperature = tempConstraint.max;
        }
      }

      // Set default if undefined and default is specified
      if (
        updatedRequest.temperature === undefined &&
        tempConstraint.default !== undefined
      ) {
        updatedRequest.temperature = tempConstraint.default;
      }
    }
  }

  // Apply top_p constraints (similar pattern)
  if (constraints.top_p) {
    const topPConstraint = constraints.top_p;

    if (updatedRequest.top_p !== undefined) {
      if (
        topPConstraint.min !== undefined &&
        updatedRequest.top_p < topPConstraint.min
      ) {
        updatedRequest.top_p = topPConstraint.min;
      }
      if (
        topPConstraint.max !== undefined &&
        updatedRequest.top_p > topPConstraint.max
      ) {
        updatedRequest.top_p = topPConstraint.max;
      }
    }

    if (
      updatedRequest.top_p === undefined &&
      topPConstraint.default !== undefined
    ) {
      updatedRequest.top_p = topPConstraint.default;
    }
  }

  // Apply max_tokens constraints
  if (constraints.max_tokens) {
    const maxTokensConstraint = constraints.max_tokens;

    if (updatedRequest.max_tokens !== undefined) {
      if (
        maxTokensConstraint.min !== undefined &&
        updatedRequest.max_tokens < maxTokensConstraint.min
      ) {
        updatedRequest.max_tokens = maxTokensConstraint.min;
      }
      if (
        maxTokensConstraint.max !== undefined &&
        updatedRequest.max_tokens > maxTokensConstraint.max
      ) {
        updatedRequest.max_tokens = maxTokensConstraint.max;
      }
    }

    if (
      updatedRequest.max_tokens === undefined &&
      maxTokensConstraint.default !== undefined
    ) {
      updatedRequest.max_tokens = maxTokensConstraint.default;
    }
  }

  return updatedRequest;
}

/**
 * Get the endpoint type for a model
 * Returns 'chat/completions' as default if not configured
 */
export function getEndpointType(modelId: string): EndpointType {
  const config = getModelConfig(modelId);
  return config?.endpoint || "chat/completions";
}
