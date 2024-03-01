# dockerfile for signaling server
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
RUN pnpm install --frozen-lockfile --filter "@apps/signaling-server"

ENV SKIP_ENV_VALIDATION=1

RUN pnpm build --filter "@apps/signaling-server"

# Runtime Stage
FROM node:20-alpine
RUN corepack enable pnpm
ENV NODE_ENV=production
ENV SKIP_ENV_VALIDATION=1

WORKDIR /app

COPY --from=builder /app/apps/signaling-server/dist /app/apps/signaling-server/dist
COPY --from=builder /app/apps/signaling-server/package.json /app/apps/signaling-server/package.json
COPY --from=builder /app/apps/signaling-server/package.json /app/apps/signaling-server/package.json
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/pnpm-lock.yaml /app/pnpm-lock.yaml
COPY --from=builder /app/pnpm-workspace.yaml /app/pnpm-workspace.yaml
COPY --from=builder /app/turbo.json /app/turbo.json

RUN pnpm install --filter "@apps/signaling-server" --frozen-lockfile --prod

EXPOSE 8080

CMD ["pnpm", "--filter", "@apps/signaling-server", "start"]
