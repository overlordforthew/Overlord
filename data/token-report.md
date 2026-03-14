# Token Usage Report — 2026-03-08
Week: 2026-03-01 to 2026-03-08 (5 days)

## Weekly Totals
- **Total calls:** 1,956
- **Input tokens:** 22,113
- **Output tokens:** 321,457
- **Cache read:** 133,618,903
- **Cache create:** 7,892,393
- **OpenRouter calls:** 12 (free)

## Per-Model Breakdown
| Model | Calls | Input | Output | Cache Read | Cache Create |
|-------|-------|-------|--------|------------|--------------|
| Opus 4.6 | 991 | 7.6K | 153.4K | 82.8M | 3.3M |
| Haiku 4.5 | 546 | 14.0K | 74.7K | 27.7M | 2.9M |
| Sonnet 4.6 | 419 | 531 | 93.4K | 23.2M | 1.7M |

## Per-Source Breakdown
| Source | Calls | Input | Output |
|--------|-------|-------|--------|
| CLI Sessions | 1,915 | 22.0K | 321.2K |
| WhatsApp Bot | 27 | 81 | 141 |
| Lumina | 10 | 27 | 98 |
| Temp/shannon | 4 | 12 | 4 |

## Daily Breakdown
| Date | Calls | Input | Output | Cache Read | Cache Create |
|------|-------|-------|--------|------------|--------------|
| 2026-03-04 | 1,055 | 20.6K | 177.7K | 67.4M | 3.8M |
| 2026-03-05 | 552 | 936 | 81.1K | 41.3M | 2.4M |
| 2026-03-06 | 0 | 0 | 0 | 0 | 0 |
| 2026-03-07 | 233 | 378 | 42.1K | 10.0M | 749.9K |
| 2026-03-08 | 116 | 155 | 20.5K | 14.9M | 1.0M |

## Context Files
**Total:** 40.5KB / ~10,368 estimated tokens per session

### Always Loaded (5.6KB / ~1,432 tokens)
- `CLAUDE.md` — 3,205 bytes, 57 lines, ~802 tokens
- `.claude/rules/security.md` — 1,385 bytes, 29 lines, ~347 tokens
- `.claude/rules/deploy.md` — 1,132 bytes, 28 lines, ~283 tokens

### Overlord (2.2KB / ~574 tokens)
- `overlord/CLAUDE.md` — 2,294 bytes, 55 lines, ~574 tokens

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

### Shared Memory (11.6KB / ~2,986 tokens)
- `.claude/projects/-root/memory/MEMORY.md` — 5,118 bytes, 92 lines, ~1,280 tokens
- `.claude/projects/-root/memory/projects.md` — 1,703 bytes, 39 lines, ~426 tokens
- `.claude/projects/-root/memory/cloudflare.md` — 1,482 bytes, 30 lines, ~371 tokens
- `.claude/projects/-root/memory/ecc-patterns.md` — 1,302 bytes, 26 lines, ~326 tokens
- `.claude/projects/-root/memory/infrastructure.md` — 1,089 bytes, 24 lines, ~273 tokens
- `.claude/projects/-root/memory/work-log.md` — 865 bytes, 22 lines, ~217 tokens
- `.claude/projects/-root/memory/mastercommander-plans.md` — 369 bytes, 7 lines, ~93 tokens

## Optimizations
- GOOD CACHE HIT RATE: 94% — sessions reusing cached context efficiently
- HIGH SESSION VOLUME: ~391 calls/day — consider consolidating tasks into fewer sessions

*Generated 2026-03-08 08:00*