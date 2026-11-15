# syntax=docker/dockerfile:1

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @liasse/server...
RUN pnpm --filter @liasse/server... build
# `--legacy`: pnpm 10 deploys workspace packages only with inject-workspace-packages, which the
# workspace does not set; legacy deploy copies each one by its `files` field (dist, migrations).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @liasse/server deploy --prod --legacy /app
# onnxruntime-node ships its CPU binaries for every platform (about 290 MB); keep the target's.
ARG TARGETARCH
RUN onnx_arch=$([ "$TARGETARCH" = amd64 ] && echo x64 || echo "$TARGETARCH") \
    && for bin in /app/node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v*; do \
         find "$bin" -mindepth 1 -maxdepth 1 ! -name linux -exec rm -rf {} + \
         && find "$bin/linux" -mindepth 1 -maxdepth 1 ! -name "$onnx_arch" -exec rm -rf {} +; \
       done \
    && test -n "$(find /app/node_modules/.pnpm -path "*/onnxruntime-node/bin/napi-v*/linux/$onnx_arch/*.node")"

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install --yes --no-install-recommends poppler-utils \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    STORAGE_PATH=/data/files \
    EMBEDDING_CACHE_DIR=/data/models
WORKDIR /app
COPY --from=build /app ./
RUN mkdir -p /data/files /data/models && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["node", "dist/main.js"]
