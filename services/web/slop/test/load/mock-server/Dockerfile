FROM node:20-slim

WORKDIR /app

COPY test/load/mock-server/package.json ./
RUN npm install --production

COPY test/load/mock-server/index.js ./
# Protos are accessed via relative path from the app dir in the container
# or we can copy them in. Let's copy them for reliability.
COPY lib/shared/proto ./lib/shared/proto

EXPOSE 8000 50051

CMD ["node", "index.js"]
