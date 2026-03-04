# Token Usage Report — 2026-03-04
Week: 2026-02-25 to 2026-03-04 (1 days)

## Weekly Totals
- **Total calls:** 1,055
- **Input tokens:** 20,644
- **Output tokens:** 177,680
- **Cache read:** 67,388,076
- **Cache create:** 3,781,021
- **OpenRouter calls:** 6 (free)

## Per-Model Breakdown
| Model | Calls | Input | Output | Cache Read | Cache Create |
|-------|-------|-------|--------|------------|--------------|
| Opus 4.6 | 561 | 7.0K | 99.1K | 41.8M | 1.5M |
| Haiku 4.5 | 332 | 13.5K | 44.0K | 16.2M | 1.6M |
| Sonnet 4.6 | 162 | 206 | 34.6K | 9.5M | 692.1K |

## Per-Source Breakdown
| Source | Calls | Input | Output |
|--------|-------|-------|--------|
| CLI Sessions | 1,024 | 20.6K | 177.5K |
| WhatsApp Bot | 17 | 51 | 85 |
| Lumina | 10 | 27 | 98 |
| Temp/shannon | 4 | 12 | 4 |

## Daily Breakdown
| Date | Calls | Input | Output | Cache Read | Cache Create |
|------|-------|-------|--------|------------|--------------|
| 2026-03-04 | 1,055 | 20.6K | 177.7K | 67.4M | 3.8M |

## Context Files
**Total:** 55.2KB / ~14,125 estimated tokens per session

### Always Loaded (5.6KB / ~1,432 tokens)
- `CLAUDE.md` — 3,205 bytes, 57 lines, ~802 tokens
- `.claude/rules/security.md` — 1,385 bytes, 29 lines, ~347 tokens
- `.claude/rules/deploy.md` — 1,132 bytes, 28 lines, ~283 tokens

### Overlord (16.8KB / ~4,308 tokens)
- `overlord/CLAUDE.md` — 17,232 bytes, 338 lines, ~4,308 tokens

### Project: Elmo (1.2KB / ~318 tokens)
- `projects/Elmo/CLAUDE.md` — 1,271 bytes, 36 lines, ~318 tokens

### Project: Lumina (1.5KB / ~377 tokens)
- `projects/Lumina/CLAUDE.md` — 1,507 bytes, 42 lines, ~377 tokens

### Project: MasterCommander (2.0KB / ~520 tokens)
- `projects/MasterCommander/CLAUDE.md` — 2,079 bytes, 53 lines, ~520 tokens

### Project: NamiBarden (1.7KB / ~439 tokens)
- `projects/NamiBarden/CLAUDE.md` — 1,754 bytes, 43 lines, ~439 tokens

### Project: OnlyHulls (1.7KB / ~441 tokens)
- `projects/OnlyHulls/CLAUDE.md` — 1,761 bytes, 39 lines, ~441 tokens

### Project: SurfaBabe (3.2KB / ~819 tokens)
- `projects/SurfaBabe/CLAUDE.md` — 3,274 bytes, 79 lines, ~819 tokens

### Project: shannon (9.6KB / ~2,462 tokens)
- `projects/shannon/CLAUDE.md` — 9,847 bytes, 159 lines, ~2,462 tokens

### Shared Memory (11.7KB / ~3,009 tokens)
- `.claude/projects/-root/memory/MEMORY.md` — 4,130 bytes, 74 lines, ~1,033 tokens
- `.claude/projects/-root/memory/infrastructure.md` — 2,290 bytes, 36 lines, ~573 tokens
- `.claude/projects/-root/memory/cloudflare.md` — 2,266 bytes, 48 lines, ~567 tokens
- `.claude/projects/-root/memory/projects.md` — 1,683 bytes, 39 lines, ~421 tokens
- `.claude/projects/-root/memory/work-log.md` — 900 bytes, 23 lines, ~225 tokens
- `.claude/projects/-root/memory/mastercommander-plans.md` — 759 bytes, 13 lines, ~190 tokens

## Optimizations
- LARGE FILE: overlord/CLAUDE.md (16.8KB / ~4,308 tokens) — consider condensing
- GOOD CACHE HIT RATE: 95% — sessions reusing cached context efficiently
- HIGH SESSION VOLUME: ~1055 calls/day — consider consolidating tasks into fewer sessions

*Generated 2026-03-04 10:57*