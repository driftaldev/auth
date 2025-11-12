
# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

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
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install OpenSSL 1.1 compatibility library for Prisma
RUN apk add --no-cache openssl1.1-compat

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

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
