FROM node:20-bookworm-slim

# Install dependencies for Claude CLI and Baileys
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Claude CLI globally
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Install app dependencies
COPY package.json ./
RUN npm install

# Copy app files
COPY index.js CLAUDE.md ./

# Create data directories
RUN mkdir -p auth data logs media

EXPOSE 0

CMD ["node", "index.js"]
