FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@11.19.0

FROM base AS workspace
# Native Node dependencies are compiled for Linux, never copied from Windows.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/types/package.json packages/types/package.json
RUN --mount=type=cache,id=atlas-pnpm,target=/pnpm/store \
    pnpm --filter @eureka-atlas/api... --filter @eureka-atlas/web... install --frozen-lockfile --store-dir /pnpm/store
COPY apps/api ./apps/api
COPY apps/web ./apps/web
COPY packages ./packages
# Generation needs a URL, but does not connect to a database. No secret build args.
RUN DATABASE_URL=postgresql://atlas:build-only@127.0.0.1:5432/atlas \
    pnpm --filter @eureka-atlas/database exec prisma generate --schema prisma/schema.prisma \
    && pnpm --filter @eureka-atlas/database build

FROM workspace AS api-build
RUN pnpm --filter @eureka-atlas/api build

FROM workspace AS web-build
# Next rewrites are baked into the build; the Compose service is named "api".
ENV API_ORIGIN=http://api:3001
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @eureka-atlas/web build

FROM base AS migrate
ENV NODE_ENV=production
COPY --from=api-build --chown=node:node /app /app
USER node
CMD ["pnpm", "--filter", "@eureka-atlas/database", "run", "deploy"]

FROM base AS api
ENV NODE_ENV=production
ENV MAXCOMPUTE_PYTHON_BIN=/opt/pyodps/bin/python
COPY apps/api/python/requirements.txt /tmp/pyodps-requirements.txt
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && python3 -m venv /opt/pyodps \
    && /opt/pyodps/bin/pip install --no-cache-dir -r /tmp/pyodps-requirements.txt \
    && rm -f /tmp/pyodps-requirements.txt \
    && rm -rf /var/lib/apt/lists/*
COPY --from=api-build --chown=node:node /app /app
WORKDIR /app/apps/api
USER node
EXPOSE 3001
CMD ["node", "--enable-source-maps", "dist/main.js"]

FROM base AS web
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV API_ORIGIN=http://api:3001
COPY --from=web-build --chown=node:node /app /app
WORKDIR /app/apps/web
USER node
EXPOSE 3000
CMD ["pnpm", "start", "--hostname", "0.0.0.0", "--port", "3000"]
