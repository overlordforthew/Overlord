#!/bin/bash
# repo-analyzer.sh — Analyze a GitHub repo and identify extractable skills
# Usage: repo-analyzer.sh <github-url|local-path> [--local] [--quick]
set -u

REPO_INPUT="${1:-}"
LOCAL_MODE=false
QUICK_MODE=false
REPOS_DIR="/tmp/repos"

for arg in "$@"; do
  case "$arg" in
    --local) LOCAL_MODE=true ;;
    --quick) QUICK_MODE=true ;;
  esac
done

if [ -z "$REPO_INPUT" ]; then
  echo "Usage: repo-analyzer.sh <github-url|local-path> [--local] [--quick]"
  exit 1
fi

# Determine repo path
if [ "$LOCAL_MODE" = true ]; then
  REPO_PATH="$REPO_INPUT"
  REPO_NAME=$(basename "$REPO_PATH")
  REPO_URL="local://$REPO_PATH"
else
  # Extract org/repo from GitHub URL
  REPO_SLUG=$(echo "$REPO_INPUT" | sed -E 's|https?://github\.com/||' | sed 's|\.git$||' | sed 's|/$||')
  REPO_NAME=$(echo "$REPO_SLUG" | tr '/' '-')
  REPO_URL="$REPO_INPUT"
  REPO_PATH="$REPOS_DIR/$REPO_NAME"

  # Clone or update
  mkdir -p "$REPOS_DIR"
  if [ -d "$REPO_PATH" ]; then
    echo "Repo already cloned, pulling latest..."
    cd "$REPO_PATH" && git pull --quiet 2>/dev/null || true
    cd /
  else
    echo "Cloning $REPO_URL..."
    git clone --depth 1 --quiet "$REPO_URL" "$REPO_PATH" 2>/dev/null
  fi
fi

if [ ! -d "$REPO_PATH" ]; then
  echo "ERROR: Repo path does not exist: $REPO_PATH"
  exit 1
fi

cd "$REPO_PATH"

echo "Analyzing $REPO_NAME..."

# Get repo metadata
STAR_COUNT="unknown"
LICENSE="unknown"
DESCRIPTION=""
PRIMARY_LANG=""

# Try to get GitHub metadata via gh if available
if command -v gh &>/dev/null && [ "$LOCAL_MODE" = false ]; then
  GH_DATA=$(gh repo view "$REPO_SLUG" --json stargazerCount,licenseInfo,description,primaryLanguage 2>/dev/null || echo "{}")
  STAR_COUNT=$(echo "$GH_DATA" | jq -r '.stargazerCount // "unknown"' 2>/dev/null || echo "unknown")
  LICENSE=$(echo "$GH_DATA" | jq -r '.licenseInfo.name // "unknown"' 2>/dev/null || echo "unknown")
  DESCRIPTION=$(echo "$GH_DATA" | jq -r '.description // ""' 2>/dev/null || echo "")
  PRIMARY_LANG=$(echo "$GH_DATA" | jq -r '.primaryLanguage.name // ""' 2>/dev/null || echo "")
fi

# Fallback: detect primary language from file extensions
if [ -z "$PRIMARY_LANG" ]; then
  PY_COUNT=$(find . -name "*.py" -not -path "*/node_modules/*" -not -path "*/.git/*" | wc -l)
  JS_COUNT=$(find . -name "*.js" -o -name "*.ts" -not -path "*/node_modules/*" -not -path "*/.git/*" | wc -l)
  SH_COUNT=$(find . -name "*.sh" -not -path "*/.git/*" | wc -l)
  GO_COUNT=$(find . -name "*.go" -not -path "*/.git/*" | wc -l)
  RS_COUNT=$(find . -name "*.rs" -not -path "*/.git/*" | wc -l)

  MAX=0; PRIMARY_LANG="Unknown"
  for lang_count in "Python:$PY_COUNT" "JavaScript:$JS_COUNT" "Shell:$SH_COUNT" "Go:$GO_COUNT" "Rust:$RS_COUNT"; do
    LANG="${lang_count%%:*}"
    COUNT="${lang_count##*:}"
    if [ "$COUNT" -gt "$MAX" ]; then
      MAX="$COUNT"
      PRIMARY_LANG="$LANG"
    fi
  done
fi

# Map file structure
echo "Mapping file structure..."

# Tools: scripts, CLIs, executables
TOOLS=$(find . -not -path "*/.git/*" -not -path "*/node_modules/*" -not -path "*/__pycache__/*" \
  \( -name "*.sh" -o -name "*.py" -o -name "*.js" -o -name "*.ts" \) \
  -type f | head -100 | sort)

# Prompts: system prompts, templates, agent definitions
PROMPTS=$(find . -not -path "*/.git/*" -not -path "*/node_modules/*" \
  \( -iname "*prompt*" -o -iname "*agent*" -o -iname "*system*" -o -iname "*template*" -o -iname "SKILL*" \) \
  -type f | head -50 | sort)

# Configs: docker, CI, package managers
CONFIGS=$(find . -maxdepth 2 -not -path "*/.git/*" \
  \( -name "docker-compose*" -o -name "Dockerfile*" -o -name "package.json" -o -name "pyproject.toml" \
  -o -name "Cargo.toml" -o -name "go.mod" -o -name ".github" -o -name "Makefile" \
  -o -name "tsconfig*" -o -name "*.toml" -o -name "*.yaml" -o -name "*.yml" \) \
  -type f 2>/dev/null | head -30 | sort)

# Docs: READMEs, guides
DOCS=$(find . -maxdepth 3 -not -path "*/.git/*" -not -path "*/node_modules/*" \
  \( -iname "README*" -o -iname "CONTRIBUTING*" -o -iname "*.md" -o -iname "docs" \) \
  -type f 2>/dev/null | head -30 | sort)

# Count total files
TOTAL_FILES=$(find . -not -path "*/.git/*" -not -path "*/node_modules/*" -type f | wc -l)

# Read README for understanding
README_CONTENT=""
for readme in README.md readme.md README.rst README; do
  if [ -f "$readme" ]; then
    README_CONTENT=$(head -200 "$readme")
    break
  fi
done

# Read package.json or pyproject.toml for deps
DEPS_INFO=""
if [ -f "package.json" ]; then
  DEPS_INFO=$(jq '{dependencies, devDependencies, scripts}' package.json 2>/dev/null || echo "")
elif [ -f "pyproject.toml" ]; then
  DEPS_INFO=$(head -80 pyproject.toml)
elif [ -f "Cargo.toml" ]; then
  DEPS_INFO=$(head -60 Cargo.toml)
elif [ -f "go.mod" ]; then
  DEPS_INFO=$(head -40 go.mod)
fi

# Quick mode: skip deep file reading
KEY_FILES_CONTENT=""
if [ "$QUICK_MODE" = false ]; then
  echo "Deep analysis — reading key files..."

  # Read entry points and important files (first 100 lines each)
  for pattern in "main.py" "index.js" "index.ts" "main.go" "src/main.rs" "app.py" "cli.py" "server.js" "server.ts"; do
    FOUND=$(find . -name "$(basename "$pattern")" -not -path "*/node_modules/*" -not -path "*/.git/*" -type f | head -3)
    for f in $FOUND; do
      if [ -f "$f" ]; then
        KEY_FILES_CONTENT="$KEY_FILES_CONTENT
--- FILE: $f ---
$(head -100 "$f")
"
      fi
    done
  done

  # Read any SKILL, AGENT, PROMPT, or system prompt files fully
  for f in $PROMPTS; do
    if [ -f "$f" ]; then
      KEY_FILES_CONTENT="$KEY_FILES_CONTENT
--- FILE: $f ---
$(head -150 "$f")
"
    fi
  done
fi

# Build the full tree (compact)
echo "Building file tree..."
TREE=$(find . -not -path "*/.git/*" -not -path "*/node_modules/*" -not -path "*/__pycache__/*" \
  -not -path "*/dist/*" -not -path "*/build/*" -not -path "*/.next/*" \
  -type f | sed 's|^\./||' | sort | head -200)

# Detect API key requirements
API_KEY_REQUIRED="false"
API_KEY_HINTS=""
if [ -n "$README_CONTENT" ]; then
  # Check README for API key indicators
  API_MATCHES=$(echo "$README_CONTENT" | grep -i -E 'api[_ -]?key|api[_ -]?token|secret[_ -]?key|access[_ -]?token|OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY|SERPAPI|requires.*key|sign up for.*api|get your.*key' | head -5)
  if [ -n "$API_MATCHES" ]; then
    API_KEY_REQUIRED="true"
    API_KEY_HINTS="$API_MATCHES"
  fi
fi
# Also check for .env.example or .env.sample with API key patterns
for envfile in .env.example .env.sample .env.template; do
  if [ -f "$envfile" ]; then
    ENV_MATCHES=$(grep -i -E 'api[_ -]?key|api[_ -]?token|secret[_ -]?key|_KEY=|_TOKEN=|_SECRET=' "$envfile" | head -5)
    if [ -n "$ENV_MATCHES" ]; then
      API_KEY_REQUIRED="true"
      API_KEY_HINTS="$API_KEY_HINTS
$ENV_MATCHES"
    fi
  fi
done

# Write analysis data for LLM processing
ANALYSIS_FILE="$REPO_PATH/ANALYSIS_RAW.txt"
cat > "$ANALYSIS_FILE" <<ANALYSIS_EOF
REPO: $REPO_NAME
URL: $REPO_URL
STARS: $STAR_COUNT
LICENSE: $LICENSE
DESCRIPTION: $DESCRIPTION
PRIMARY_LANGUAGE: $PRIMARY_LANG
TOTAL_FILES: $TOTAL_FILES
API_KEY_REQUIRED: $API_KEY_REQUIRED

=== API KEY INDICATORS ===
$API_KEY_HINTS

=== FILE TREE ===
$TREE

=== TOOLS (scripts/executables) ===
$TOOLS

=== PROMPTS/AGENTS ===
$PROMPTS

=== CONFIGS ===
$CONFIGS

=== DOCS ===
$DOCS

=== README ===
$README_CONTENT

=== DEPENDENCIES ===
$DEPS_INFO

=== KEY FILE CONTENTS ===
$KEY_FILES_CONTENT
ANALYSIS_EOF

echo ""
echo "Analysis complete: $ANALYSIS_FILE"
echo "Total files: $TOTAL_FILES"
echo "Tools found: $(echo "$TOOLS" | grep -c . || echo 0)"
echo "Prompts found: $(echo "$PROMPTS" | grep -c . || echo 0)"
echo "Primary language: $PRIMARY_LANG"
echo ""
echo "Next step: Run skill-extract.sh $REPO_PATH to generate SKILL.md drafts"
echo "Or: Read ANALYSIS_RAW.txt and use Claude to identify extractable skills"
