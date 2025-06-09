FROM node:20-slim
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable

WORKDIR /app

COPY ./pnpm-lock.yaml ./pnpm-lock.yaml
COPY ./package.json ./pnpm-workspace.yaml ./turbo.json ./
COPY ./packages/ui/package.json ./packages/ui/
COPY ./apps/web/package.json ./apps/web/
COPY ./apps/web/prisma ./apps/web/prisma

RUN CI=true pnpm install --frozen-lockfile

COPY . .

EXPOSE 3000
CMD ["pnpm", "run", "dev"]