FROM node:22-alpine
RUN corepack enable pnpm
ENV NODE_ENV=production
ENV SKIP_ENV_VALIDATION=1

WORKDIR /app

COPY ./apps/signaling-server/package.json /app/apps/signaling-server/package.json
COPY ./package.json /app/package.json
COPY ./pnpm-lock.yaml /app/pnpm-lock.yaml
COPY ./pnpm-workspace.yaml /app/pnpm-workspace.yaml
COPY ./turbo.json /app/turbo.json

RUN pnpm install --filter "@apps/signaling-server" --frozen-lockfile --prod

EXPOSE 8080

CMD ["pnpm", "--filter", "@apps/signaling-server", "start"]
