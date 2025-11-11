// ScoutCLI Backend - Main entry point

import express, { Express } from "express";
import cors from "cors";
import helmet from "helmet";
import { config, isProduction } from "./config/index.js";
import { logger } from "./config/logger.js";
import { initializeSupabase } from "./services/supabase.js";
import { initializePrisma, disconnectPrisma } from "./services/prisma.js";
import {
  errorHandler,
  notFoundHandler,
  requestLogger,
  requestTimeout,
} from "./middleware/error.js";
import { globalRateLimiter } from "./middleware/rate-limit.js";

// Import routes
import authRoutes from "./routes/auth.js";
import proxyRoutes from "./routes/proxy.js";
import healthRoutes from "./routes/health.js";

// Initialize Express app
const app: Express = express();

// ============================================================================
// Middleware Setup
// ============================================================================

// Trust proxy if configured (required for Railway, Render, etc.)
if (config.trustProxy) {
  app.set("trust proxy", true);
}

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: isProduction(),
    crossOriginEmbedderPolicy: isProduction(),
  })
);

// CORS configuration
const corsOptions = {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void
  ) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) {
      return callback(null, true);
    }

    // Check if origin matches allowed patterns
    const isAllowed = config.allowedOrigins.some((allowedOrigin) => {
      // Support wildcard patterns like http://localhost:*
      if (allowedOrigin.includes("*")) {
        const pattern = allowedOrigin.replace("*", ".*");
        const regex = new RegExp(`^${pattern}$`);
        return regex.test(origin);
      }
      return allowedOrigin === origin;
    });

    if (isAllowed) {
      callback(null, true);
    } else {
      logger.warn("CORS blocked origin", { origin });
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));

// Body parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Request logging
app.use(requestLogger);

// Request timeout
app.use(requestTimeout(30000)); // 30 seconds

// Global rate limiting
app.use(globalRateLimiter);

// ============================================================================
// Static Files
// ============================================================================

// Serve static files (auth page, etc.)
app.use(express.static("public"));

// ============================================================================
// Routes
// ============================================================================

// Health check (no rate limiting)
app.use("/health", healthRoutes);

// Authentication routes
app.use("/auth", authRoutes);

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    name: "ScoutCLI Backend",
    version: "1.0.0",
    status: "running",
    endpoints: {
      health: "/health",
      auth: {
        token: "POST /auth/token",
        refresh: "POST /auth/refresh",
        signup: "POST /auth/signup",
        signin: "POST /auth/signin",
      },
      proxy: {
        chat: "POST /v1/chat/completions",
        usage: "GET /v1/usage",
        models: "GET /v1/models",
        mossCredentials: "GET /v1/moss/credentials",
        morphCredentials: "GET /v1/morph/credentials",
      },
      web: {
        auth: "GET /cli/auth",
      },
    },
  });
});

// CLI auth endpoint (serves the web authentication page)
app.get("/cli/auth", (req, res) => {
  res.sendFile("auth.html", { root: "public" });
});

// LLM proxy routes (must come after public endpoints to avoid auth redirect loop)
app.use(proxyRoutes);

// ============================================================================
// Error Handling
// ============================================================================

// 404 handler
app.use(notFoundHandler);

// Global error handler (must be last)
app.use(errorHandler);

// ============================================================================
// Server Startup
// ============================================================================

async function startServer() {
  try {
    logger.info("Starting ScoutCLI Backend...");

    // Initialize Prisma (database ORM)
    initializePrisma();
    logger.info("✓ Prisma client initialized");

    // Initialize Supabase (authentication only)
    initializeSupabase();
    logger.info("✓ Supabase Auth initialized");

    // Start server
    app.listen(config.port, () => {
      logger.info(`✓ Server running on port ${config.port}`);
      logger.info(`✓ Environment: ${config.nodeEnv}`);
      logger.info(`✓ Health check: http://localhost:${config.port}/health`);
      logger.info(`✓ Web auth page: http://localhost:${config.port}/cli/auth`);
      logger.info("");
      logger.info("🚀 ScoutCLI Backend is ready!");
    });
  } catch (error) {
    logger.error("Failed to start server", { error });
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully...");
  await disconnectPrisma();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down gracefully...");
  await disconnectPrisma();
  process.exit(0);
});

// Start the server
startServer();

export default app;
