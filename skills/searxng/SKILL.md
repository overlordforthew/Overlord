# Skill: searxng

## Description
Privacy-respecting meta-search engine that aggregates results from multiple search engines. Provides web search capability for Overlord without API keys or rate limits. Useful for research, fact-checking, and web intelligence tasks.

## Type
Service (Docker container) + Shell tool

## Configuration
- Container: `searxng` (on `coolify` network)
- Internal port: 8080 (use this from other containers)
- Host port: 8888 (mapped on host as `127.0.0.1:8888`)
- Internal URL: `http://searxng:8080` (from other containers)
- Host URL: `http://127.0.0.1:8888`
- Settings: `/projects/Overlord/searxng/settings.yml`
- Compose: `/projects/Overlord/searxng/docker-compose.yml`

## Shell Tool

`searxng-tool.sh` provides direct CLI access to SearXNG search and config.

### Commands

| Command | Arguments | Description |
|---------|-----------|-------------|
| `search` | `<query> [options]` | Search the web |
| `engines` | — | List available search engines by category |
| `stats` | — | Show instance status, engine count, version |

### Search Options

| Flag | Description | Default |
|------|-------------|---------|
| `--engines <list>` | Comma-separated engine names | all enabled |
| `--limit N` | Max results to display | 5 |
| `--categories <list>` | Comma-separated categories | general |

### Examples

```bash
# Basic search
./searxng-tool.sh search "rust async best practices"

# Targeted search with specific engines
./searxng-tool.sh search "hetzner pricing" --engines google,duckduckgo --limit 3

# Category search
./searxng-tool.sh search "surfboard fins" --categories general

# List engines
./searxng-tool.sh engines

# Health check
./searxng-tool.sh stats
```

### Output Format

Search results are printed as clean text:
```
=== Search Results (5 of 42) ===

[1] Title of First Result
    https://example.com/page
    Snippet text from the result...

[2] Title of Second Result
    https://other.com/article
    Another snippet...
```

### Environment Overrides
- `SEARXNG_HOST` — hostname (default: `searxng`)
- `SEARXNG_PORT` — port (default: `8080`)

## When to Use
- Web search from Overlord without external API keys
- Research and fact-checking during conversations
- Gathering competitive intelligence or market data
- Finding documentation, tutorials, or reference material
- Any task where the bot needs to look something up online

## Requirements
- Docker on `coolify` network
- ~512MB RAM
- No API keys needed
