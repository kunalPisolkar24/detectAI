FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lockb ./
COPY prisma ./prisma
RUN bun install --frozen-lockfile --production
RUN bunx prisma generate
COPY . .
ENV NODE_ENV=production