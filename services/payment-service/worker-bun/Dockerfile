FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lockb* ./
COPY . .
RUN bun install
EXPOSE 7777
CMD ["bun", "run", "start"]