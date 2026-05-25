FROM oven/bun:1 AS build
WORKDIR /app

COPY services/api/package.json services/api/bun.lock* ./
RUN bun install --frozen-lockfile

COPY services/api/tsconfig.json ./
COPY services/api/migrations ./migrations
COPY services/api/src ./src
RUN bun run build

FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3200

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/package.json ./package.json

EXPOSE 3200

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3200/health || exit 1

CMD ["node", "dist/index.js"]
