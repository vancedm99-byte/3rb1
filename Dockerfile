# Build & Run Stremio Addon
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency definitions
COPY package*.json ./
COPY bun.lock* ./

# Install dependencies
RUN npm ci || npm install

# Copy source code and config
COPY . .

# Build Vite frontend and bundled Node server
RUN npm run build

# Production runtime
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV CHROMIUM_PATH=/usr/bin/chromium-browser

# System Chromium for the Egydead Cloudflare challenge solver.
# Playwright's own downloaded browser is a glibc build and will NOT run on
# Alpine (musl) — so we install Chromium via apk instead and point
# playwright-core at it via CHROMIUM_PATH (see src/utils/cloudflareSolver.ts).
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Copy production artifacts
COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/index.html ./index.html

EXPOSE 3000

CMD ["npm", "start"]