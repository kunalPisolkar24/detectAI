FROM node:20-slim

WORKDIR /app

COPY test/load/seed/package.json ./
RUN npm install --production

COPY test/load/seed/seed.mjs ./

CMD ["node", "seed.mjs"]
