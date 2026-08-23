FROM oven/bun:1 AS deps
WORKDIR /app/server
COPY server/package.json server/bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1 AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/server/node_modules ./server/node_modules
COPY server/migrations ./server/migrations
COPY server/package.json server/tsconfig.json ./server/
COPY server/src ./server/src
# shared/ holds the token clamp that server/src/indexing imports. It carries no
# dependencies of its own, so it needs no node_modules beside it — only the
# same repo-root layout, so ../../../shared resolves in the image exactly as it
# does in a checkout.
COPY shared ./shared

WORKDIR /app/server
EXPOSE 3201
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD bun -e "const r=await fetch('http://127.0.0.1:3201/health'); if(!r.ok) process.exit(1)"
CMD ["bun", "src/index.ts"]
