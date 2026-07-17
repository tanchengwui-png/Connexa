FROM node:22-bookworm-slim AS base

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ARG DATABASE_URL=postgresql://build:build@127.0.0.1:5432/connexa_build?schema=public
ENV DATABASE_URL=${DATABASE_URL}

FROM base AS build-base

COPY package.json package-lock.json ./

FROM build-base AS deps-build

RUN npm ci --include=dev --no-audit --fund=false \
  && npm cache clean --force

FROM deps-build AS deps-prod

RUN npm prune --omit=dev \
  && npm cache clean --force

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

COPY package.json package-lock.json ./
COPY --from=deps-prod /app/node_modules ./node_modules
COPY --from=prisma-client /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=prisma-client /app/node_modules/@prisma ./node_modules/@prisma

COPY . .

CMD ["npm", "run", "sender:service"]

FROM runtime-with-deps AS worker

COPY . .

CMD ["npm", "run", "worker:messages"]

FROM runtime-with-deps AS web

COPY --from=web-builder /app/.next ./.next
COPY --from=web-builder /app/public ./public
COPY --from=web-builder /app/prisma ./prisma
COPY --from=web-builder /app/next.config.ts ./next.config.ts

CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0", "--port", "3000"]
