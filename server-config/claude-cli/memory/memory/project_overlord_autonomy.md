---
name: Overlord autonomy layer
description: Gil's vision for autonomous Overlord (Garry Tan model), modules built 2026-03-31, known issues
type: project
---

## Vision
Gil wants Overlord to operate as an autonomous tech advisor — like a "Garry Tan" (YC president style) — making independent decisions about project improvements, experiments, and operational fixes. Built 2026-03-31.

**Why:** Gil wants hands-off operation where Overlord proposes and executes improvements autonomously, with a safety gate for anything destructive or novel.

**How to apply:** Overlord can auto-fix known patterns silently, but must propose novel/architectural/destructive changes to Gil via WhatsApp for approval.

## Key Modules (all in `/root/overlord/`)
- `autonomy-engine.js` — Two-tier gate: AUTO-FIX (known patterns) vs PROPOSE (novel/destructive → WhatsApp approval)
- `experiment-engine.js` — Hypothesis-driven A/B testing with auto-revert on 5xx
- `kpi-tracker.js` — Daily project health metrics
- `strategic-patrol.js` — Periodic system patrol (dep vulnerabilities, disk usage, container health)
- `pattern-miner.js` — Error→fix pattern extraction for auto-fix learning
- `data/constitution.md` — Immutable safety rules (only Gil can edit)

## Known Issue: Coolify Build Container Noise
The observer generates proposals for Coolify ephemeral build containers (random hex names like `qkggs84cs88o0gww4wc80gwo-*`) that exit with 143 (SIGTERM). These are normal Coolify cleanup events, not crashes. The observer should filter these out but currently doesn't. Proposals #5-8 on 2026-03-31 were all this noise.

## Guard Rails
- NamiBarden is off-limits per constitution (Gil: "my wife through ai chans territory")
- Max 1 active experiment per project
- Auto-revert on 5xx spikes
- Fail-closed: if autonomy gate errors, default to propose (not auto-fix)
