---
name: scrape-integrity
description: "OnlyHulls scraper pipeline integrity audit. Runs all 13 scrapers' health checks, data quality audits, monitors running jobs, and reports issues. Use when: 'scrape status', 'integrity check', 'how are the scrapers', 'boat data quality', 'check scraping'."
---

# OnlyHulls Scrape Integrity Audit

You are the data integrity watchdog for the OnlyHulls boat marketplace. Run a comprehensive audit of the scraping pipeline and report results.

## Project Context
- **Project**: `/root/projects/OnlyHulls/`
- **DB**: `onlyhulls-db` container, PostgreSQL, user `onlyhulls`, db `onlyhulls`, port 5433
- **13 scraper sources**: Sailboat Listings, TheYachtMarket, Catamarans.com, Moorings, Denison, Apollo Duck US, CatamaranSite, Multihull World, Multihull Company, Camper & Nicholsons, VI Yacht Broker, Dream Yacht Sales, Boote & Yachten
- **Scrapers**: `/root/projects/OnlyHulls/scraper/scrape_*.py`
- **Import script**: `/root/projects/OnlyHulls/scripts/import-scraped.ts`
- **Daily cron**: `37 5 * * *` runs `/root/projects/OnlyHulls/scripts/daily-scrape.sh`
- **Smart tagging**: `scripts/smart-tag.ts` (Groq Llama 3.3 70B, GROQ_API_KEY from `/root/overlord/.env`)
- **Stale expiry**: `scripts/expire-stale.ts` (14-day window)
- **TYM is IP-blocked on Hetzner** — scraper auto-routes through ElmoServer (100.89.16.27) via SSH

## Audit Protocol

Run these checks IN ORDER and report as a dashboard:

### 1. Running Jobs
```bash
ps aux | grep -E "scrape_|smart-tag|import-scraped|expire-stale" | grep -v grep
```
Report any running scrapers, their PIDs, runtime, and what they're doing.

### 2. Inventory Summary
```sql
SELECT source_name, count(*) as boats,
       round(avg(asking_price_usd)) as avg_usd,
       max(last_seen_at::date) as last_scraped
FROM boats WHERE status='active'
GROUP BY source_name ORDER BY 2 DESC;
```
Plus total count. Flag any source where `last_scraped` is more than 2 days old.

### 3. Data Quality Checks
Run each of these and report PASS/FAIL with counts:

| Check | SQL | PASS threshold |
|-------|-----|----------------|
| No garbage prices | `asking_price < 500` | 0 |
| All have year | `year IS NULL` | 0 |
| All have make | `make IS NULL OR make = ''` | 0 |
| All have slug | `slug IS NULL` | 0 |
| All have source_url | `source_url IS NULL` | 0 |
| No duplicate URLs | `GROUP BY source_url HAVING count(*) > 1` | 0 |
| Image coverage | `NOT EXISTS (SELECT 1 FROM boat_media ...)` | < 10% of total |
| DNA coverage | `NOT EXISTS (SELECT 1 FROM boat_dna ...)` | 0 |
| Specs populated | `specs = '{}'` in boat_dna | < 5% of total |

### 4. Per-Source Quality (30-boat sample)
For each source, spot-check 3 random boats:
```sql
SELECT b.make, b.model, b.year, b.asking_price, b.currency, b.location_text,
       (SELECT count(*) FROM boat_media m WHERE m.boat_id = b.id) as images,
       d.specs, left(d.ai_summary, 100) as description
FROM boats b JOIN boat_dna d ON d.boat_id = b.id
WHERE b.status='active' AND b.source_name = '{source}'
ORDER BY random() LIMIT 3;
```
Flag boats with: missing images, empty specs, no location, suspicious prices.

### 5. Freshness Check
```sql
SELECT source_name,
       count(*) FILTER (WHERE last_seen_at > NOW() - interval '1 day') as fresh_1d,
       count(*) FILTER (WHERE last_seen_at > NOW() - interval '7 days') as fresh_7d,
       count(*) FILTER (WHERE last_seen_at <= NOW() - interval '14 days') as stale_14d
FROM boats WHERE status='active'
GROUP BY source_name ORDER BY stale_14d DESC;
```
Flag any source with >10% stale listings.

### 6. Cron Health
```bash
crontab -l | grep onlyhulls
cat /tmp/onlyhulls-scrape.log | tail -20
```
Verify daily cron is configured and last run was successful.

### 7. TYM Proxy Status
```bash
curl -sS -o /dev/null -w "%{http_code}" -L "https://www.theyachtmarket.com/" 2>&1
ssh -o ConnectTimeout=5 root@100.89.16.27 "curl -sS -o /dev/null -w '%{http_code}' -L 'https://www.theyachtmarket.com/'" 2>&1
```
Report: Hetzner direct (expected 503), ElmoServer proxy (expected 200).

## Output Format

```
╔══════════════════════════════════════════╗
║     ONLYHULLS SCRAPE INTEGRITY REPORT   ║
╠══════════════════════════════════════════╣

📊 INVENTORY: {total} active boats across {sources} sources

🔄 RUNNING JOBS:
  {job list or "None"}

✅ QUALITY CHECKS:
  {check}: PASS/FAIL ({count})
  ...

📡 SOURCE HEALTH:
  {source}: {count} boats | last scraped: {date} | {status}
  ...

🔍 SAMPLE AUDIT:
  {source}: {pass/fail details}
  ...

⏰ FRESHNESS:
  {freshness summary}

🔧 INFRASTRUCTURE:
  Cron: {status}
  TYM proxy: Hetzner={code}, ElmoServer={code}
  Smart tagging: {status}

⚠️ ISSUES FOUND:
  1. {issue and recommended action}
  ...

╚══════════════════════════════════════════╝
```

## Key Rules
- NEVER modify data — this is read-only audit
- Report issues with specific counts and recommended fixes
- Flag anything that would make a boat look bad on the website (missing images, bad prices, garbled text)
- Compare against previous audit if one exists in `/tmp/onlyhulls-integrity.log`
- Save results to `/tmp/onlyhulls-integrity.log` for tracking over time
