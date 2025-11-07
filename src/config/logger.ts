// Winston logger configuration

import winston from 'winston';
import { config } from './index.js';

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Console format (human-readable for development)
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;

    // Add metadata if present
    const metaStr = Object.keys(meta).length
      ? '\n' + JSON.stringify(meta, null, 2)
      : '';

    return msg + metaStr;
  })
);

// Create transports array
const transports: winston.transport[] = [
  // Console transport (always enabled)
  new winston.transports.Console({
    format: config.nodeEnv === 'production' ? logFormat : consoleFormat,
  }),
];

// Add file transport if LOG_FILE is specified
if (config.logFile) {
  transports.push(
    new winston.transports.File({
      filename: config.logFile,
      format: logFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    })
  );
}

// Create logger instance
export const logger = winston.createLogger({
  level: config.logLevel,
  format: logFormat,
  transports,
  // Don't exit on handled exceptions
  exitOnError: false,
});

// Stream for Morgan HTTP logging middleware
export const morganStream = {
  write: (message: string) => {
    logger.info(message.trim());
  },
};

// Helper functions for structured logging
export const logRequest = (
  method: string,
  url: string,
  statusCode: number,
  duration: number,
  userId?: string
) => {
  logger.info('HTTP Request', {
    method,
    url,
    statusCode,
    duration,
    userId,
  });
};

export const logError = (
  error: Error,
  context?: Record<string, unknown>
) => {
  logger.error(error.message, {
    stack: error.stack,
    ...context,
  });
};

export const logLLMRequest = (
  userId: string,
  model: string,
  provider: string,
  tokens: number,
  duration: number
) => {
  logger.info('LLM Request', {
    userId,
    model,
    provider,
    tokens,
    duration,
  });
};

export const logAuthentication = (
  event: 'login' | 'logout' | 'token_exchange' | 'token_refresh',
  userId: string,
  success: boolean,
  details?: Record<string, unknown>
) => {
  logger.info(`Auth: ${event}`, {
    userId,
    success,
    ...details,
  });
};

// Log unhandled rejections and exceptions
process.on('unhandledRejection', (reason: Error) => {
  logger.error('Unhandled Rejection', {
    reason: reason.message,
    stack: reason.stack,
  });
});

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception', {
    error: error.message,
    stack: error.stack,
  });
  // Give logger time to write before exiting
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

export default logger;
