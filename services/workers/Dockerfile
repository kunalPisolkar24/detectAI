FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lockb* ./
COPY prisma ./prisma

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

RUN bun install

RUN bunx prisma generate

COPY . .

ENV NODE_ENV=production