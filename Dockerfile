# ---- Base ----
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl ffmpeg

# ---- Dependencies ----
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma/
RUN npm ci --ignore-scripts
RUN npx prisma generate

# ---- Build ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npm run build

# ---- Obfuscator ----
FROM base AS obfuscator
WORKDIR /app
RUN npm install -g javascript-obfuscator

# Copy built standalone app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy protection scripts
COPY protection/ ./protection/

# Step 1: Obfuscate server-side JS (chunks + API routes + server.js)
# Skip: node_modules, .next/static (client), prisma
RUN echo "[OBFUSCATOR] Obfuscating server chunks..." && \
    find .next/server/chunks -name '*.js' -size +0c 2>/dev/null | head -200 | while read f; do \
      javascript-obfuscator "$f" --output "$f" --config protection/obfuscator-config.json 2>/dev/null || true; \
    done && \
    echo "[OBFUSCATOR] Obfuscating API routes..." && \
    find .next/server/app/api -name '*.js' -size +0c 2>/dev/null | head -200 | while read f; do \
      javascript-obfuscator "$f" --output "$f" --config protection/obfuscator-config.json 2>/dev/null || true; \
    done && \
    echo "[OBFUSCATOR] Obfuscating server.js..." && \
    javascript-obfuscator server.js --output server.js --config protection/obfuscator-config.json 2>/dev/null || true && \
    echo "[OBFUSCATOR] Done."

# Step 2: Obfuscate hardware-guard.js BEFORE integrity manifest
RUN javascript-obfuscator protection/hardware-guard.js --output protection/hardware-guard.js \
      --config protection/obfuscator-config.json 2>/dev/null || true

# Step 3: Generate integrity manifest (hashes obfuscated code + injects key into integrity-check.js)
RUN node protection/integrity-build.js

# Step 4: Obfuscate integrity-check.js LAST (key is already injected inside)
RUN javascript-obfuscator protection/integrity-check.js --output protection/integrity-check.js \
      --config protection/obfuscator-config.json 2>/dev/null || true

# ---- Production ----
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy obfuscated app from obfuscator stage
COPY --from=obfuscator /app/public ./public
COPY --from=obfuscator /app/.next ./.next
COPY --from=obfuscator /app/server.js ./server.js
COPY --from=obfuscator /app/node_modules ./node_modules
COPY --from=obfuscator /app/package.json ./package.json

# Copy protection (obfuscated)
COPY --from=obfuscator /app/protection ./protection

# Copy prisma
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

# Copy seeds
COPY --from=builder /app/prisma/seed.ts ./prisma/seed.ts
COPY --from=builder /app/prisma/seed-demo.ts ./prisma/seed-demo.ts

# Create data directories (streams + recordings + frames)
RUN mkdir -p /app/data/frames /app/data/search-photos /app/data/streams /app/data/recordings /app/prisma
RUN chown -R nextjs:nodejs /app/data /app/prisma

# Entrypoint
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

LABEL com.centurylinklabs.watchtower.scope="cam-ai"

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
