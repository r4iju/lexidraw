# Alpine Bun
FROM oven/bun:alpine as build

WORKDIR /app

# Copy necessary files
# Works as long as the app doesn't rely on workspace dependencies
COPY ./apps/signaling-server/src /app/src
COPY ./apps/signaling-server/package.json /app/package.json

# Workspace dev dependencies caused issues with bun install
RUN sed -i '/"devDependencies"/d' /app/package.json
# Install dependencies for the signaling server
RUN bun install --production

# Set up environment variables
ENV NODE_ENV=production
ENV SKIP_ENV_VALIDATION=1

# Expose the application port
EXPOSE 8080

# Start the application
CMD ["bun", "/app/src/index.ts"]
