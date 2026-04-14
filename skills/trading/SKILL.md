# Skill: Trading Bot Development

## Scope
Crypto trading bot development, backtesting, and deployment.

## Architecture Options
- **Node.js + ccxt** — Most popular crypto trading library, supports 100+ exchanges
- **Python + ccxt** — Same library, Python version
- **Freqtrade** — Open-source Python trading bot framework with backtesting

## Key Libraries
- **ccxt** — Unified API for crypto exchanges
- **ta-lib / technicalindicators** — Technical analysis indicators
- **node-cron** — Scheduled execution

## Development Steps
1. Choose exchange(s) and trading pairs
2. Implement strategy (signals, entry/exit rules)
3. Backtest against historical data
4. Paper trade (simulate without real money)
5. Deploy with small position sizes
6. Monitor and iterate

## Deployment on This Server
- Run as Docker container on Coolify
- Store API keys in environment variables (never in code)
- Use PostgreSQL for trade history
- Set up alerts (WhatsApp via Overlord bot)

## Risk Management
- Always use stop-losses
- Never risk more than 1-2% per trade
- Start with paper trading
- Log every trade decision for review

## Safety
- NEVER commit exchange API keys to git
- Use read-only API keys for monitoring
- Separate trading keys from withdrawal keys
- Test on testnet first when available
