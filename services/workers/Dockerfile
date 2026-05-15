FROM oven/bun:1-slim AS builder

WORKDIR /app

COPY package.json bun.lock* ./
COPY prisma ./prisma

RUN bun install --frozen-lockfile

RUN DATABASE_URL=postgresql://127.0.0.1:5432/dummy bunx prisma generate

COPY . .

FROM oven/bun:1-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

RUN chown bun:bun /app

COPY --chown=bun:bun package.json bun.lock* ./

USER bun



RUN bun install --production --frozen-lockfile --ignore-scripts

COPY --from=builder --chown=bun:bun /app/generated ./generated
COPY --from=builder --chown=bun:bun /app/src ./src
COPY --from=builder --chown=bun:bun /app/prisma.config.ts ./
COPY --from=builder --chown=bun:bun /app/bunfig.toml ./
COPY --from=builder --chown=bun:bun /app/tsconfig.json ./