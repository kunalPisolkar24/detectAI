FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lockb* ./
COPY prisma ./prisma

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

RUN DATABASE_URL=postgresql://127.0.0.1:5432/dummy bun install
RUN DATABASE_URL=postgresql://127.0.0.1:5432/dummy bunx prisma generate

COPY . .

ENV NODE_ENV=production