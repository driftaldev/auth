# Stage 1: Build
FROM node:20-slim AS builder

WORKDIR /app

# Install OpenSSL to match the production environment *before* installing dependencies
RUN apt-get update && \
    apt-get install -y openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Copy Prisma schema
COPY prisma ./prisma

# Install all dependencies (including devDependencies needed for build)
RUN npm ci

# Copy source code
COPY src ./src

# Build TypeScript (this will also run prisma generate via build script)
RUN npm run build

# Stage 2: Production
FROM node:20-slim

# Set working directory
WORKDIR /app

# Install OpenSSL and other required libraries for Prisma
RUN apt-get update && \
    apt-get install -y openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r nodejs && \
    useradd -r -g nodejs nodejs

# Copy package files
COPY package*.json ./

# Copy Prisma schema (needed for @prisma/client to work)
COPY prisma ./prisma

# Install production dependencies only, skipping postinstall scripts
RUN npm ci --only=production --ignore-scripts && \
    npm cache clean --force

# Copy generated Prisma client from builder
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Copy public files (auth page, etc.)
COPY public ./public

# Copy Supabase migrations
COPY supabase ./supabase

# Change ownership to nodejs user
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "dist/index.js"]