FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install
COPY . .
RUN bun prisma generate
EXPOSE 7777
CMD ["bun", "run", "index.ts"]