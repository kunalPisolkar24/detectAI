FROM node:20-alpine AS base

RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g pnpm

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS source
COPY . .
RUN pnpm exec prisma generate

FROM base AS migrate
WORKDIR /app
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm install prisma@7.2.0 tsx dotenv
CMD ["npx", "prisma", "migrate", "deploy"]

FROM source AS builder

ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_PADDLE_CLIENT_TOKEN
ARG NEXT_PUBLIC_PREVIEW_MODE
ARG PREVIEW_MODE

ENV SKIP_ENV_VALIDATION=true
ENV DATABASE_URL="postgresql://localhost:5432/dummy"
ENV DATABASE_URL_REPLICA="postgresql://localhost:5432/dummy"
ENV NEXTAUTH_SECRET="dummy-secret"
ENV REDIS_USAGE_URL="redis://localhost:6379"
ENV REDIS_MASTER_NAME="mymaster"
ENV REDIS_SENTINELS="localhost:26379,localhost:26380,localhost:26381"
ENV FILE_EXTRACTOR_API_URL="http://localhost:8080"
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY="${NEXT_PUBLIC_TURNSTILE_SITE_KEY}"
ENV NEXT_PUBLIC_PADDLE_CLIENT_TOKEN="${NEXT_PUBLIC_PADDLE_CLIENT_TOKEN}"
ENV NEXT_PUBLIC_PREVIEW_MODE="${NEXT_PUBLIC_PREVIEW_MODE}"
ENV PREVIEW_MODE="${PREVIEW_MODE}"
ENV AI_SERVICE_URL="localhost:50051"
ENV AI_SERVICE_API_KEY="dummy"
ENV GOOGLE_ID="dummy"
ENV GOOGLE_SECRET="dummy"
ENV GITHUB_ID="dummy"
ENV GITHUB_SECRET="dummy"
ENV TURNSTILE_SECRET_KEY="dummy"
ENV NEXTAUTH_URL="http://localhost:3000"
ENV RABBITMQ_URL="amqp://guest:guest@localhost:5672"

RUN pnpm build

FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node

EXPOSE 3000

CMD HOSTNAME="0.0.0.0" node server.js
