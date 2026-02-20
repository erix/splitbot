FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app

# Copy all deps (including dev for drizzle-kit migrations)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src

# Copy drizzle config if present
COPY --from=builder /app/drizzle.config.* ./
COPY --from=builder /app/tsconfig.json ./

RUN mkdir -p /data

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV DATABASE_PATH=/data/splitbot.db

ENTRYPOINT ["/entrypoint.sh"]
