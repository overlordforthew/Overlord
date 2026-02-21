#!/bin/bash
# ============================================================
# WhatsApp Claude Bridge — Setup Script
# Run this on your Hetzner server
# ============================================================

set -e

echo "╔══════════════════════════════════════════╗"
echo "║   WhatsApp Claude Bridge — Setup          ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Check prerequisites
echo "🔍 Checking prerequisites..."

# Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Installing..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi
echo "✅ Node.js $(node --version)"

# Claude CLI
if ! command -v claude &> /dev/null; then
    echo "❌ Claude CLI not found!"
    echo "   Install it with: npm install -g @anthropic-ai/claude-code"
    echo "   Then run: claude (to authenticate)"
    exit 1
fi
echo "✅ Claude CLI found"

# Setup project
PROJECT_DIR="/root/overlord"

if [ ! -d "$PROJECT_DIR" ]; then
    echo "📁 Creating project directory..."
    mkdir -p "$PROJECT_DIR"
fi

# Copy files (if running from a different location)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "$SCRIPT_DIR" != "$PROJECT_DIR" ]; then
    echo "📋 Copying files to $PROJECT_DIR..."
    cp "$SCRIPT_DIR/package.json" "$PROJECT_DIR/"
    cp "$SCRIPT_DIR/index.js" "$PROJECT_DIR/"
    cp "$SCRIPT_DIR/CLAUDE.md" "$PROJECT_DIR/"
    cp "$SCRIPT_DIR/.env.example" "$PROJECT_DIR/.env"
fi

cd "$PROJECT_DIR"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Create data directories
mkdir -p auth data logs

# Prompt for config
echo ""
echo "⚙️  Configuration"
echo "─────────────────"
read -p "Your WhatsApp number (with country code, no +): " ADMIN_NUM
read -p "Bot name [Claude]: " BOT_NAME
BOT_NAME=${BOT_NAME:-Claude}

# Update .env
cat > .env << EOF
ADMIN_NUMBER=$ADMIN_NUM
BOT_NAME=$BOT_NAME
CLAUDE_PATH=$(which claude)
CLAUDE_MODEL=
EOF

echo "✅ Config saved to .env"

# Install systemd service
echo ""
read -p "Install as systemd service (auto-start on boot)? [y/N]: " INSTALL_SERVICE
if [[ "$INSTALL_SERVICE" =~ ^[Yy]$ ]]; then
    # Update service file with correct paths
    sed "s|ADMIN_NUMBER=18681234567|ADMIN_NUMBER=$ADMIN_NUM|g" \
        whatsapp-claude.service > /tmp/whatsapp-claude.service
    sed -i "s|BOT_NAME=Claude|BOT_NAME=$BOT_NAME|g" /tmp/whatsapp-claude.service
    sed -i "s|CLAUDE_PATH=/usr/local/bin/claude|CLAUDE_PATH=$(which claude)|g" /tmp/whatsapp-claude.service

    cp /tmp/whatsapp-claude.service /etc/systemd/system/whatsapp-claude.service
    systemctl daemon-reload
    systemctl enable whatsapp-claude
    echo "✅ Systemd service installed"
    echo ""
    echo "⚠️  FIRST RUN: Start manually to scan QR code:"
    echo "   cd $PROJECT_DIR && node index.js"
    echo ""
    echo "   After linking WhatsApp, stop it (Ctrl+C) then start the service:"
    echo "   systemctl start whatsapp-claude"
    echo "   systemctl status whatsapp-claude"
    echo "   journalctl -u whatsapp-claude -f  (view logs)"
else
    echo ""
    echo "📋 To start manually:"
    echo "   cd $PROJECT_DIR && node index.js"
fi

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Setup complete! 🎉                      ║"
echo "║                                            ║"
echo "║   Next steps:                              ║"
echo "║   1. Run: node index.js                    ║"
echo "║   2. Scan the QR code with WhatsApp        ║"
echo "║   3. Send yourself a test message           ║"
echo "║   4. Edit CLAUDE.md to customize personality║"
echo "╚══════════════════════════════════════════╝"
