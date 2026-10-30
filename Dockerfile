FROM node:22-bookworm-slim AS base

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ARG DATABASE_URL=postgresql://build:build@127.0.0.1:5432/connexa_build?schema=public
ENV DATABASE_URL=${DATABASE_URL}

FROM base AS build-base

COPY package.json package-lock.json ./
COPY scripts/patch-whatsapp-web-media-id.mjs ./scripts/patch-whatsapp-web-media-id.mjs

FROM build-base AS deps-build

RUN npm ci --include=dev --no-audit --fund=false \
  && npm cache clean --force

FROM deps-build AS deps-prod

RUN npm prune --omit=dev \
  && npm cache clean --force

FROM deps-prod AS chrome-for-testing

ENV PUPPETEER_CACHE_DIR=/opt/puppeteer
ENV WHATSAPP_WEB_EXECUTABLE_PATH=/opt/puppeteer/chrome/linux-146.0.7680.31/chrome-linux64/chrome

# whatsapp-web.js 1.34.7 pins Puppeteer 24.38.0, whose supported browser is
# Chrome for Testing 146.0.7680.31. Keep the Debian Chromium package below as
# an operator-selectable rollback, but make the matched browser the default.
RUN PUPPETEER_SKIP_DOWNLOAD=false node node_modules/puppeteer/install.mjs \
  && test -x "$WHATSAPP_WEB_EXECUTABLE_PATH"

FROM deps-build AS prisma-client

COPY prisma ./prisma
COPY prisma.config.ts ./

RUN npm run db:generate \
  && npm cache clean --force

FROM deps-build AS web-builder

COPY . .

RUN rm -rf /app/.next \
  && npm run db:generate \
  && npm run build

FROM node:22-bookworm-slim AS runtime-base

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ARG DATABASE_URL=postgresql://build:build@127.0.0.1:5432/connexa_build?schema=public
ENV DATABASE_URL=${DATABASE_URL}

# Shared runtime deps.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    dumb-init \
    openssl \
  && rm -rf /var/lib/apt/lists/*

EXPOSE 3000 3101

ENTRYPOINT ["dumb-init", "--"]

FROM runtime-base AS runtime-browser

# Runtime deps for whatsapp-web.js / Chromium-based execution.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    ffmpeg \
    fonts-liberation \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

FROM runtime-base AS runtime-with-deps

COPY package.json package-lock.json ./
COPY --from=deps-prod /app/node_modules ./node_modules
COPY --from=prisma-client /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=prisma-client /app/node_modules/@prisma ./node_modules/@prisma

FROM runtime-browser AS sender

ENV PUPPETEER_CACHE_DIR=/opt/puppeteer
ENV WHATSAPP_WEB_EXECUTABLE_PATH=/opt/puppeteer/chrome/linux-146.0.7680.31/chrome-linux64/chrome

COPY --from=chrome-for-testing /opt/puppeteer /opt/puppeteer

RUN "$WHATSAPP_WEB_EXECUTABLE_PATH" --version | grep '146\.0\.7680\.31'

COPY package.json package-lock.json ./
COPY --from=deps-prod /app/node_modules ./node_modules
COPY --from=prisma-client /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=prisma-client /app/node_modules/@prisma ./node_modules/@prisma

COPY . .

CMD ["npm", "run", "sender:service"]

# Disposable, operator-driven linking benchmark. It inherits the same matched
# browser as the candidate sender so the comparison changes only the user agent.
FROM sender AS whatsapp-benchmark

CMD ["node", "scripts/whatsapp-isolated-linking-benchmark.mjs"]

FROM runtime-with-deps AS worker

COPY . .

CMD ["npm", "run", "worker:messages"]

FROM runtime-browser AS web

ENV PUPPETEER_CACHE_DIR=/opt/puppeteer
ENV WHATSAPP_WEB_EXECUTABLE_PATH=/opt/puppeteer/chrome/linux-146.0.7680.31/chrome-linux64/chrome

COPY --from=chrome-for-testing /opt/puppeteer /opt/puppeteer

COPY package.json package-lock.json ./
COPY --from=deps-prod /app/node_modules ./node_modules
COPY --from=prisma-client /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=prisma-client /app/node_modules/@prisma ./node_modules/@prisma

COPY --from=web-builder /app/.next ./.next
COPY --from=web-builder /app/public ./public
COPY --from=web-builder /app/prisma ./prisma
COPY --from=web-builder /app/next.config.ts ./next.config.ts
# The operator-only token utility requires an interactive TTY and explicit
# confirmation. Keep only its two reviewed server dependencies in this image.
COPY --from=web-builder /app/scripts/retrieve-meta-webhook-token.mjs ./scripts/retrieve-meta-webhook-token.mjs
COPY --from=web-builder /app/lib/crypto.ts ./lib/crypto.ts
COPY --from=web-builder /app/lib/prisma.ts ./lib/prisma.ts

CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0", "--port", "3000"]
