FROM node:20-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
WORKDIR /app

RUN corepack enable

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/agent-worker/package.json apps/agent-worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/blockchain-client/package.json packages/blockchain-client/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY tests/e2e/package.json tests/e2e/package.json

RUN pnpm install --frozen-lockfile

FROM deps AS build

COPY . .

RUN pnpm --filter @gridproof/shared-types build \
  && pnpm --filter @gridproof/blockchain-client build \
  && pnpm --filter @gridproof/api build

FROM base AS runner

ENV NODE_ENV=production

COPY --from=build /app /app

EXPOSE 4000

CMD ["node", "apps/api/dist/server.js"]
