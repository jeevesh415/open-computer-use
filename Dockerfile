# Base Node.js image
FROM node:18-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies (including devDependencies for build)
RUN npm ci && npm cache clean --force

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app

# Accept build arguments
ARG ENCRYPTION_KEY
ARG CSRF_SECRET
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG SUPABASE_SERVICE_ROLE
ARG STRIPE_API_KEY
ARG STRIPE_WEBHOOK_SECRET
ARG STRIPE_PRICE_STARTER
ARG STRIPE_PRICE_PROFESSIONAL
ARG STRIPE_PRICE_ENTERPRISE

# Set environment variables for build
ENV ENCRYPTION_KEY=$ENCRYPTION_KEY
ENV CSRF_SECRET=$CSRF_SECRET
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV SUPABASE_SERVICE_ROLE=$SUPABASE_SERVICE_ROLE
ENV STRIPE_API_KEY=$STRIPE_API_KEY
ENV STRIPE_WEBHOOK_SECRET=$STRIPE_WEBHOOK_SECRET
ENV STRIPE_PRICE_STARTER=$STRIPE_PRICE_STARTER
ENV STRIPE_PRICE_PROFESSIONAL=$STRIPE_PRICE_PROFESSIONAL
ENV STRIPE_PRICE_ENTERPRISE=$STRIPE_PRICE_ENTERPRISE

# Copy node_modules from deps
COPY --from=deps /app/node_modules ./node_modules

# Copy all project files
COPY . .

# Set Next.js telemetry to disabled
ENV NEXT_TELEMETRY_DISABLED=1

# Build the application
RUN npm run build

# Verify standalone build was created
RUN ls -la .next/ && \
    if [ ! -d ".next/standalone" ]; then \
      echo "ERROR: .next/standalone directory not found. Make sure output: 'standalone' is set in next.config.ts"; \
      exit 1; \
    fi

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

# Set environment variables
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create a non-root user and install curl for reliable health checks
# (BusyBox wget on Alpine has inconsistent exit-code behavior)
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    apk add --no-cache curl

# Copy public assets (only if it exists)
COPY --from=builder /app/public ./public

# Copy standalone application
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# Copy static assets
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Ensure proper permissions for nextjs user
RUN chown -R nextjs:nodejs /app

# Switch to non-root user
USER nextjs

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -sf http://localhost:3000/api/health || exit 1

# Expose application port
EXPOSE 3000

# Set environment variable for port
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Start the application
CMD ["node", "server.js"]
