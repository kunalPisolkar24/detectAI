FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY . .

# Copy protos from the web app directory (will be handled by docker context or volume)
# For simplicity in this plan, we assume the protos are copied into the image context
# or available via a relative path if the context is root.
# However, for a standalone mock-server, we'll expect them at a specific path.

EXPOSE 8000 50051

CMD ["node", "index.js"]
