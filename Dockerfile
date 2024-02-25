# Use the official Node.js 14 image.
# https://hub.docker.com/_/node
FROM node:20-alpine

# Create and change to the app directory.
WORKDIR /usr/src/app

COPY package*.json ./
COPY pnpm-lock.yaml ./
COPY pnmp-workspace.yaml ./
COPY tsconfig.json ./
COPY tune.json ./

# Install production dependencies.
RUN pnpm install --only=production

# Copy local code to the container image.
COPY . .

# Set the environment to production
ENV NODE_ENV=production

# Run the web service on container startup.
CMD [ "cd", "apps/collaborator", "&&", "node", "dist/index.js" ]
