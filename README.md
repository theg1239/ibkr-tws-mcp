# IBKR TWS MCP

An MCP server for Interactive Brokers' TWS/IB Gateway socket API, built with Bun. Connects AI assistants (Codex, Claude, Cursor, etc.) directly to a locally running IB Gateway or TWS session for market data, portfolio context, and order execution.

This is a direct socket API wrapper. It speaks IBKR's wire protocol.

## Disclaimer

**This software can place, modify, and cancel real orders on a live brokerage account. Use it at your own risk.**

- Orders submitted through this server execute against your real account. Losses are your responsibility.
- AI assistants can misinterpret instructions, hallucinate symbols or quantities, and make errors that cost real money. Always review order details before approving any confirmation.
- The built-in stock analysis engine (scores, grades, risk tiers) is a mechanical heuristic for structuring data. It is not investment advice and has no predictive guarantees.
- Market data may be delayed, stale, or missing entitlements. Do not rely solely on data returned by this server for time-sensitive decisions.
- The per-call approval gate requires an MCP client with form elicitation support. If bypassed via `IBKR_MCP_ALLOW_UNSUPPORTED_ELICITATION=1`, orders can execute without explicit confirmation.
- This project is not affiliated with, endorsed by, or supported by Interactive Brokers.
- Start on a paper trading account (`port 4002`) and verify behavior thoroughly before connecting to a live session.

## What it does

- Pulls live or delayed quotes, historical bars, and scanner results
- Returns portfolio state (positions, balances, open orders, P&amp;L) in a single call
- Scores and ranks stock setups using a built-in technical analysis engine
- Submits, modifies, and cancels stock orders with a mandatory per-call approval gate
- Returns richer payloads from fewer tool calls; most planning workflows need 1-3 calls

## Prerequisites

**IB Gateway or TWS must be running locally with:**

- Socket API access enabled
- Local connections allowed from `127.0.0.1`
- Paper trading port `4002` (default), or live port `4001`

If you lack live market data entitlements, get the agent to use market data type `3` (delayed quotes).

MCP clients with form elicitation approval are required. This can be bypassed by env var (not recommended).

## Setup

```bash
bun install
bun run start
```

### MCP config

```json
{
  "mcpServers": {
    "ibkr-gateway": {
      "command": "bun",
      "args": ["run", "/path/to/ibkr-desktop-mcp/index.ts"]
    }
  }
}
```

**Defaults**: `127.0.0.1:4002`, `clientId=0`. If you run multiple clients concurrently, assign a nonzero `clientId` to each.

## Approval model

Every tool call goes through an explicit approval step via MCP elicitation before execution.

- **With elicitation support**: a per-call confirmation form appears in the client
- **Without elicitation support**: the server returns `approval_unavailable` and does nothing
- **Unsafe override**: set `IBKR_MCP_ALLOW_UNSUPPORTED_ELICITATION=1` to auto-approve in fully trusted local setups

## Tools

### Session and account

| Tool | Description |
|------|-------------|
| `connect_gateway` | Open a socket connection to IB Gateway or TWS |
| `disconnect_gateway` | Close the connection |
| `connection_status` | Session state, server version, cached order ID |
| `list_managed_accounts` | Available account identifiers |
| `get_current_time` | Server timestamp (useful for heartbeat checks) |
| `get_next_valid_order_id` | Required before placing an order manually |
| `get_market_data_type` | Current data mode: live / frozen / delayed / delayed-frozen |
| `set_market_data_type` | Set data mode (1=live, 2=frozen, 3=delayed, 4=delayed-frozen) |
| `get_account_summary` | Account balances and margin values |
| `get_positions` | Current portfolio positions snapshot |
| `get_gateway_snapshot` | All-in-one planning snapshot (see below) |

### Market data and analysis

| Tool | Description |
|------|-------------|
| `search_stocks` | Symbol search (returns STK contracts only) |
| `get_market_data_snapshot` | Top-of-book quote for one symbol or a batch |
| `get_stock_historical_bars` | Daily + optional intraday bars with built-in technical study |
| `get_stock_portfolio_overview` | Balances, held-position quotes, live P&L, concentration |
| `scan_stock_market` | Real-time scanner with preset support |
| `get_stock_market_scenario` | Benchmark ETFs + top gainers / losers / most active |
| `get_stock_trade_candidates` | Ranked shortlist combining scanner + studies + portfolio context |

### Orders

| Tool | Description |
|------|-------------|
| `preview_stock_order` | What-if order preview: margin and commission impact, no execution |
| `submit_stock_order` | Place or modify a stock order (runs preview first by default) |
| `cancel_stock_order` | Cancel by order ID |

## Key usage patterns

### Full planning snapshot in one call

`get_gateway_snapshot` with all flags set returns session state, account summary, positions, open orders, account-level P&L, and current quotes for every held position:

```json
{
  "includeAccountSummary": true,
  "includePositions": true,
  "includeOpenOrders": true,
  "includeAccountLivePnl": true,
  "heldStockSnapshotsMarketDataType": 3
}
```

Set `includeHeldStockSnapshots: false` only if you want positions without quote enrichment.

### Batch quote fetch

Pull quotes for multiple symbols in one call with configurable concurrency:

```json
{
  "symbols": ["AAPL", "MSFT", "NVDA", "AMD"],
  "marketDataType": 3,
  "batchConcurrency": 4
}
```

### Scanner with quote enrichment

```json
{
  "preset": "liquid_leaders",
  "marketDataType": 3,
  "includeSnapshots": true
}
```

Available presets: `intraday_momentum`, `opening_gap_up`, `opening_gap_down`, `liquid_leaders`, `liquid_losers`

### Ranked trading shortlist

Combines portfolio concentration, market scenario, intraday scanner, and scored stock studies:

```json
{
  "scannerPreset": "liquid_leaders",
  "marketDataType": 3,
  "includeIntradayBars": false,
  "rankLimit": 8
}
```

## Stock analysis engine

`get_stock_historical_bars` with `includeAnalysis: true` runs a scoring pass over each symbol's bars. The engine computes:

- SMA 20/50/100, ATR14, returns across 1D/5D/20D/60D periods
- Bid/ask spread, relative volume
- 20-day high/low levels, breakout distance, pullback reference
- A score (0–100) with letter grade (A–D) and risk tier (normal / reduced / small / none)

Scores of 60+ are flagged as eligible for new entries. `rankStockSetups()` sorts by score → 20D return → spread.

Risk thresholds (hardcoded): max spread 25 bps, min avg daily volume 250k, max ATR14 8%, max breakout extension 3%.

## Implementation notes

- Uses Bun-native `Bun.connect()` for raw socket I/O
- Order submission uses IBKR's protobuf path for gateways that support it (detected via `serverVersion`)
- Delayed-data fallback warnings are returned as structured warnings rather than errors
- All requests have configurable per-call timeouts (500–30,000 ms)
- Strategy layer is stock-only; lower-level protocol messages are more general

## Scope and limitations

This server wraps IBKR's socket API and provides execution primitives and decision-support data. It does not:

- Guarantee profitable results or protect against losses
- Replace your own risk management process or position sizing discipline
- Substitute for broker-side controls, margin rules, or account restrictions
- Validate that an AI-generated order matches your actual intent

You are responsible for every order that gets submitted through this tool.

## Testing

```bash
# Type check
bun run check

# Unit tests
bun test

# Live integration tests (requires a running IB Gateway session)
IBKR_RUN_LIVE_TESTS=1 IB_TEST_CLIENT_ID=97 bun run test:live
```

## References

- [IBKR TWS API documentation](https://www.interactivebrokers.com/campus/ibkr-api-page/twsapi-doc/)
