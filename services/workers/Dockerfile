FROM oven/bun:1-slim AS builder

WORKDIR /app

COPY package.json bun.lock* ./
COPY prisma ./prisma

RUN bun install --frozen-lockfile

RUN DATABASE_URL=postgresql://127.0.0.1:5432/dummy bun prisma generate

COPY . .

FROM oven/bun:1-slim AS prod-deps

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN chown bun:bun /app

COPY --chown=bun:bun package.json bun.lock* ./

COPY --from=prod-deps --chown=bun:bun /app/node_modules /app/node_modules

USER bun

COPY --from=builder --chown=bun:bun /app/generated ./generated
COPY --from=builder --chown=bun:bun /app/prisma ./prisma
COPY --from=builder --chown=bun:bun /app/src ./src
COPY --from=builder --chown=bun:bun /app/prisma.config.ts ./
COPY --from=builder --chown=bun:bun /app/bunfig.toml ./
COPY --from=builder --chown=bun:bun /app/tsconfig.json ./
