// Error handling middleware

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  RateLimitError,
  NotFoundError,
  ProviderError,
} from '../types/index.js';
import { logger, logError } from '../config/logger.js';
import { config } from '../config/index.js';

/**
 * Convert various error types to AppError
 */
function normalizeError(error: unknown): AppError {
  // Already an AppError
  if (error instanceof AppError) {
    return error;
  }

  // Zod validation error
  if (error instanceof ZodError) {
    return new ValidationError('Validation failed', {
      issues: error.errors.map((err) => ({
        path: err.path.join('.'),
        message: err.message,
      })),
    });
  }

  // Standard Error
  if (error instanceof Error) {
    return new AppError(500, error.message);
  }

  // Unknown error
  return new AppError(500, 'An unexpected error occurred');
}

/**
 * Error response interface
 */
interface ErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
  stack?: string;
}

/**
 * Main error handling middleware
 * Should be the last middleware in the chain
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const appError = normalizeError(error);

  // Log the error
  logError(appError, {
    method: req.method,
    url: req.url,
    userId: req.userId,
    ip: req.ip,
  });

  // Build error response
  const response: ErrorResponse = {
    error: appError.message,
    code: appError.code,
  };

  // Add details in development mode or for validation errors
  if (config.nodeEnv === 'development' || appError instanceof ValidationError) {
    response.details = appError.details;
  }

  // Add stack trace in development
  if (config.nodeEnv === 'development') {
    response.stack = appError.stack;
  }

  // Add Retry-After header for rate limit errors
  if (appError instanceof RateLimitError && appError.details) {
    const { retryAfter } = appError.details as { retryAfter?: number };
    if (retryAfter) {
      res.setHeader('Retry-After', retryAfter);
    }
  }

  // Send error response
  res.status(appError.statusCode).json(response);
}

/**
 * 404 Not Found handler
 * Should be placed after all routes but before error handler
 */
export function notFoundHandler(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  next(
    new NotFoundError(`Route ${req.method} ${req.path} not found`)
  );
}

/**
 * Async handler wrapper to catch promise rejections
 * Wraps async route handlers to automatically catch errors
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Validation middleware factory
 * Creates middleware to validate request body/query/params with Zod schema
 */
export function validate(
  schema: {
    body?: any;
    query?: any;
    params?: any;
  }
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (schema.body) {
        req.body = await schema.body.parseAsync(req.body);
      }
      if (schema.query) {
        req.query = await schema.query.parseAsync(req.query);
      }
      if (schema.params) {
        req.params = await schema.params.parseAsync(req.params);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Request timeout middleware
 */
export function requestTimeout(timeoutMs: number = 30000) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        logger.warn('Request timeout', {
          method: req.method,
          url: req.url,
          timeout: timeoutMs,
        });
        res.status(408).json({
          error: 'Request timeout',
          code: 'TIMEOUT_ERROR',
        });
      }
    }, timeoutMs);

    // Clear timeout when response is sent
    res.on('finish', () => {
      clearTimeout(timeout);
    });

    next();
  };
}

/**
 * Request logging middleware
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const startTime = Date.now();

  // Log when response is finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info('HTTP Request', {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration,
      userId: req.userId,
      ip: req.ip,
    });
  });

  next();
}

/**
 * Health check for error handling
 * Ensures error middleware is working
 */
export function testErrorHandler(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.query.test === 'error') {
    throw new Error('Test error');
  }
  next();
}
