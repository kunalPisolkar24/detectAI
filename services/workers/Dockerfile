FROM oven/bun:1-slim AS builder

WORKDIR /app

COPY package.json bun.lock* ./
COPY prisma ./prisma

RUN bun install --frozen-lockfile

RUN DATABASE_URL=postgresql://127.0.0.1:5432/dummy bunx prisma generate

COPY . .