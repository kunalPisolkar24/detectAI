FROM oven/bun:1-slim AS builder

WORKDIR /app

COPY package.json bun.lock* ./
COPY prisma ./prisma

# postinstall runs `prisma generate`, which requires DATABASE_URL — mock it;
# the real client is generated against the real DB schema, not data.
RUN DATABASE_URL=postgresql://127.0.0.1:5432/mock-db-not-configured bun install --frozen-lockfile

RUN DATABASE_URL=postgresql://127.0.0.1:5432/mock-db-not-configured bun prisma generate

COPY . .

FROM oven/bun:1-slim AS migrate

WORKDIR /app

COPY package.json bun.lock* ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# postinstall runs `prisma generate`, which loads prisma.config.ts and requires
# DATABASE_URL — a mock value suffices at build time; the real URL comes from
# the stack environment at runtime (same pattern as the builder stage below).
RUN DATABASE_URL=postgresql://127.0.0.1:5432/mock-db-not-configured bun install --frozen-lockfile

CMD ["bun", "prisma", "migrate", "deploy"]

FROM oven/bun:1-slim AS prod-deps

WORKDIR /app

COPY package.json bun.lock* ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN DATABASE_URL=postgresql://127.0.0.1:5432/mock-db-not-configured bun install --frozen-lockfile --production

FROM oven/bun:1-slim AS runner

WORKDIR /app

ENV ENV_TYPE=prod

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
