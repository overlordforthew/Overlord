FROM node:20-bookworm-slim

# Install system dependencies: git, Docker CLI, GitHub CLI, Python 3, jq
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    curl \
    gnupg \
    jq \
    python3 \
    python3-pip \
    python3-venv \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get update \
    && apt-get install -y --no-install-recommends chromium \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages for skills (scraping, APIs, data analysis)
# Plus llm CLI (universal LLM interface) with provider plugins
RUN pip3 install --no-cache-dir --break-system-packages \
    requests \
    beautifulsoup4 \
    lxml \
    feedparser \
    matplotlib \
    edge-tts \
    llm \
    llm-openrouter \
    pyyaml \
    langdetect \
    twikit \
    scrapling \
    curl_cffi \
    browserforge \
    playwright

# Install Claude CLI and Codex CLI globally
RUN npm install -g @anthropic-ai/claude-code @openai/codex

WORKDIR /app

# Install app dependencies
COPY package.json ./
RUN npm install

# Copy app files
COPY index.js server.js scheduler.js meta-learning.js CLAUDE.md traefik-watcher.sh ./

# Copy skills and scripts into container
COPY skills/ ./skills/
COPY scripts/ ./scripts/

# Create data directories
RUN mkdir -p auth data logs media

EXPOSE 3001

CMD ["sh", "-c", "cp /tmp/.gitconfig-host /root/.gitconfig 2>/dev/null; cp /tmp/.git-credentials-host /root/.git-credentials 2>/dev/null; if [ -n \"$OPENROUTER_KEY\" ]; then llm keys set openrouter --value \"$OPENROUTER_KEY\" 2>/dev/null; fi; ./traefik-watcher.sh >> /app/logs/traefik-watcher.log 2>&1 & exec node index.js"]
