# Build Stage
FROM node:20-alpine as builder

# Set working directory
WORKDIR /app

# Copy package.json files and other root-level config necessary for installation
COPY package.json ./
COPY pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./
COPY turbo.json ./

# Install pnpm
RUN corepack enable pnpm

# Copy the entire monorepo
COPY . .
# --filter "./apps/collaborator"
RUN pnpm install --frozen-lockfile --filter "@apps/collaborator"

ENV SKIP_ENV_VALIDATION=1

RUN pnpm build --filter "@apps/collaborator"

# Runtime Stage
FROM node:20-alpine
RUN corepack enable pnpm
ENV NODE_ENV=production
ENV SKIP_ENV_VALIDATION=1

WORKDIR /app

COPY --from=builder /app/apps/collaborator/dist /app/apps/collaborator/dist
COPY --from=builder /app/apps/collaborator/package.json /app/apps/collaborator/package.json
COPY --from=builder /app/packages/db/dist /app/packages/db/dist
COPY --from=builder /app/packages/db/prisma /app/packages/db/prisma
COPY --from=builder /app/packages/db/src /app/packages/db/src
COPY --from=builder /app/packages/db/package.json /app/packages/db/package.json
COPY --from=builder /app/packages/lib/dist /app/packages/lib/dist
COPY --from=builder /app/packages/lib/package.json /app/packages/lib/package.json
COPY --from=builder /app/packages/env/dist /app/packages/env/dist
COPY --from=builder /app/packages/env/package.json /app/packages/env/package.json
COPY --from=builder /app/apps/collaborator/package.json /app/apps/collaborator/package.json
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/pnpm-lock.yaml /app/pnpm-lock.yaml
COPY --from=builder /app/pnpm-workspace.yaml /app/pnpm-workspace.yaml
COPY --from=builder /app/turbo.json /app/turbo.json

RUN npm i -g prisma && \
    pnpm install --filter "@apps/collaborator" --frozen-lockfile --prod

EXPOSE 8080

CMD ["pnpm", "--filter", "@apps/collaborator", "start"]
