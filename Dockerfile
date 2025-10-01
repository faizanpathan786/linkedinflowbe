ARG PORT=3000
FROM node:20-slim

ENV PORT=3000
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm install

# Copy source code
COPY src ./src
COPY tsconfig.json ./

# Build the application
RUN npm run build

# Remove dev dependencies to reduce image size
RUN npm prune --production

EXPOSE ${PORT}
CMD [ "node", "dist/index.js" ]

