# Token Usage Report — 2026-03-15
Week: 2026-03-08 to 2026-03-15 (8 days)

## Weekly Totals
- **Total calls:** 2,064
- **Input tokens:** 92,149
- **Output tokens:** 429,494
- **Cache read:** 123,455,827
- **Cache create:** 14,533,749
- **OpenRouter calls:** 6 (free)

## Per-Model Breakdown
| Model | Calls | Input | Output | Cache Read | Cache Create |
|-------|-------|-------|--------|------------|--------------|
| Sonnet 4.6 | 1,166 | 30.3K | 276.2K | 83.1M | 7.9M |
| Opus 4.6 | 867 | 60.1K | 148.0K | 39.8M | 6.4M |
| Haiku 4.5 | 31 | 1.7K | 5.3K | 545.2K | 221.7K |

## Per-Source Breakdown
| Source | Calls | Input | Output |
|--------|-------|-------|--------|
| CLI Sessions | 1,796 | 39.2K | 373.2K |
| NamiBarden | 191 | 52.7K | 52.6K |
| WhatsApp Bot | 77 | 231 | 3.8K |

## Daily Breakdown
| Date | Calls | Input | Output | Cache Read | Cache Create |
|------|-------|-------|--------|------------|--------------|
| 2026-03-08 | 116 | 155 | 20.5K | 14.9M | 1.0M |
| 2026-03-09 | 75 | 195 | 10.7K | 2.2M | 2.7M |
| 2026-03-10 | 748 | 21.7K | 196.7K | 59.7M | 2.2M |
| 2026-03-11 | 512 | 3.9K | 80.9K | 20.9M | 5.4M |
| 2026-03-12 | 0 | 0 | 0 | 0 | 0 |
| 2026-03-13 | 306 | 7.3K | 62.3K | 15.3M | 796.1K |
| 2026-03-14 | 175 | 4.6K | 24.0K | 5.2M | 1.2M |
| 2026-03-15 | 132 | 54.3K | 34.5K | 5.2M | 1.2M |

## Context Files
**Total:** 31.0KB / ~7,930 estimated tokens per session

### Always Loaded (7.2KB / ~1,843 tokens)
- `CLAUDE.md` — 4,708 bytes, 77 lines, ~1,177 tokens
- `.claude/rules/security.md` — 1,385 bytes, 29 lines, ~347 tokens
- `.claude/rules/deploy.md` — 1,132 bytes, 28 lines, ~283 tokens
- `.claude/rules/clarification.md` — 144 bytes, 3 lines, ~36 tokens

### Overlord (2.2KB / ~574 tokens)
- `overlord/CLAUDE.md` — 2,294 bytes, 55 lines, ~574 tokens

### Project: Elmo (1.8KB / ~455 tokens)
- `projects/Elmo/CLAUDE.md` — 1,819 bytes, 48 lines, ~455 tokens

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

## Optimizations
- GOOD CACHE HIT RATE: 89% — sessions reusing cached context efficiently
- HIGH SESSION VOLUME: ~258 calls/day — consider consolidating tasks into fewer sessions

*Generated 2026-03-15 08:00*