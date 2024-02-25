# Build Stage
FROM node:20-alpine as builder

# Set working directory
WORKDIR /usr/src/app

# Copy package.json files and other root-level config necessary for installation
COPY package.json ./
COPY pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./
COPY turbo.json ./

# Install pnpm
RUN npm install -g pnpm

# Copy the entire monorepo
COPY . .

# Install dependencies and build the specific project
RUN pnpm install --frozen-lockfile
RUN cd apps/collaborator && pnpm build

# Runtime Stage
FROM node:20-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy only the built code and necessary runtime files or folders from the builder stage
COPY --from=builder /usr/src/app/apps/collaborator/dist /usr/src/app/dist

# If your application has runtime dependencies, install them
# Assuming your collaborator project has a separate package.json for runtime dependencies
COPY --from=builder /usr/src/app/apps/collaborator/package.json /usr/src/app/package.json
RUN npm install --only=production

# Set the environment to production
ENV NODE_ENV=production

# Expose the port the app runs on
EXPOSE 8080

# Command to run the application
CMD ["node", "dist/index.js"]
