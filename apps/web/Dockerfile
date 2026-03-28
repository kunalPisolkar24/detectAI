FROM node:20-alpine

RUN apk add --no-cache libc6-compat

WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .

RUN npx prisma generate

ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_PADDLE_CLIENT_TOKEN

ENV SKIP_ENV_VALIDATION=true
ENV DATABASE_URL="postgresql://localhost:5432/dummy"
ENV DATABASE_URL_REPLICA="postgresql://localhost:5432/dummy"
ENV NEXTAUTH_SECRET="dummy-secret"
ENV REDIS_USAGE_URL="redis://localhost:6379"
ENV REDIS_MASTER_NAME="mymaster"
ENV FILE_EXTRACTOR_API_URL="http://localhost:8080"
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY="${NEXT_PUBLIC_TURNSTILE_SITE_KEY}"
ENV NEXT_PUBLIC_PADDLE_CLIENT_TOKEN="${NEXT_PUBLIC_PADDLE_CLIENT_TOKEN}"
ENV AI_SERVICE_URL="localhost:50051"
ENV AI_SERVICE_API_KEY="dummy"
ENV GOOGLE_ID="dummy"
ENV GOOGLE_SECRET="dummy"
ENV GITHUB_ID="dummy"
ENV GITHUB_SECRET="dummy"
ENV TURNSTILE_SECRET_KEY="dummy"

RUN test -n "$NEXT_PUBLIC_TURNSTILE_SITE_KEY" && test "$NEXT_PUBLIC_TURNSTILE_SITE_KEY" != "dummy" \
 && test -n "$NEXT_PUBLIC_PADDLE_CLIENT_TOKEN" && test "$NEXT_PUBLIC_PADDLE_CLIENT_TOKEN" != "dummy"

RUN pnpm build

EXPOSE 3000

CMD ["pnpm", "start"]
