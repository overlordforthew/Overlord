---
name: skill-harvester
version: 1.0.0
description: "Automated skill extraction from GitHub repos. Analyzes repo structure, identifies procedural knowledge, and generates draft SKILL.md files in Overlord format."
---

# Skill Harvester

Automated procedural knowledge extraction from GitHub repositories. Based on the multi-agent skill acquisition framework (arxiv:2603.11808). Takes a GitHub URL, analyzes the repo, identifies extractable skills, and generates draft SKILL.md files ready for review.

## Available Tools

### repo-analyzer.sh
Analyze a GitHub repo's structure and identify skill-worthy components.
```bash
# Full analysis — clone, map structure, identify skills
/app/skills/skill-harvester/repo-analyzer.sh https://github.com/org/repo

# Analyze a specific local path (already cloned)
/app/skills/skill-harvester/repo-analyzer.sh /tmp/repos/repo-name --local

# Quick mode — skip deep file analysis, just structure + README
/app/skills/skill-harvester/repo-analyzer.sh https://github.com/org/repo --quick
```

### skill-extract.sh
Extract identified skills into SKILL.md drafts.
```bash
# Extract all identified skills from analysis
/app/skills/skill-harvester/skill-extract.sh /tmp/repos/repo-name

# Extract a specific skill by name from the analysis
/app/skills/skill-harvester/skill-extract.sh /tmp/repos/repo-name --skill "memory-management"

# Generate and auto-stage to drafts directory
/app/skills/skill-harvester/skill-extract.sh /tmp/repos/repo-name --stage
```

## How It Works

### Phase 1: Repo Analysis (repo-analyzer.sh)
1. Clone repo to /tmp/repos/
2. Map file tree — identify directories, entry points, configs
3. Categorize files: tools (scripts/CLIs), prompts (system prompts/templates), configs (docker/CI), docs (READMEs/guides)
4. Read key files: README, main entry points, package.json/pyproject.toml, any SKILL/AGENT/PROMPT files
5. Generate structured analysis JSON at /tmp/repos/<name>/ANALYSIS.json

### Phase 2: Skill Extraction (skill-extract.sh)
1. Read ANALYSIS.json
2. For each identified skill-worthy component:
   - Determine if it's a tool skill (has executable scripts) or instruction skill (knowledge/process only)
   - Extract the procedural knowledge (workflows, prompts, patterns)
   - Translate to Overlord SKILL.md format
   - Adapt paths, dependencies, and tool references to our stack
3. Write drafts to /tmp/skill-drafts/<skill-name>/SKILL.md
4. If --stage: copy to /projects/Overlord/skills/<skill-name>/ as DRAFT-SKILL.md

### Phase 3: Review (manual)
Gil reviews drafts, approves or adjusts, then renames DRAFT-SKILL.md to SKILL.md.

## Analysis JSON Schema

```json
{
  "repo": "org/repo-name",
  "url": "https://github.com/org/repo",
  "stars": 12345,
  "license": "MIT",
  "description": "...",
  "primary_language": "Python",
  "structure": {
    "tools": ["path/to/script.py", "..."],
    "prompts": ["path/to/prompt.md", "..."],
    "configs": ["docker-compose.yml", "..."],
    "docs": ["README.md", "..."]
  },
  "skills_identified": [
    {
      "name": "skill-name",
      "type": "tool|instruction",
      "source_files": ["..."],
      "description": "...",
      "relevance": "high|medium|low",
      "relevance_reason": "Why this matters for Overlord",
      "dependencies": ["python3", "..."],
      "conflicts": "Any conflicts with existing skills"
    }
  ],
  "key_patterns": ["..."],
  "not_extractable": ["Reason X component was skipped"]
}
```

## Overlord SKILL.md Format

Every generated skill MUST follow this template:
```markdown
---
name: <skill-name>
version: 1.0.0
description: "<one-line description>"
source: "<github-url> (harvested)"
---

# <Skill Name>

<2-3 sentence description of what this skill does.>

## Available Tools (if tool skill)
<script usage examples>

## Process (if instruction skill)
<numbered steps>

## When to Use
<trigger conditions>
```

## Integration with Friday Report

The skill harvester feeds into the weekly tech intelligence report. During the Friday scan:
1. Trending repos are identified
2. repo-analyzer.sh runs on top candidates
3. Any high-relevance skills are extracted as drafts
4. Report includes: "X draft skills extracted — review at /tmp/skill-drafts/"

## When to Use
- User shares a GitHub URL and asks to "extract skills", "harvest", "take the good parts"
- User says "analyze this repo for useful patterns"
- Friday tech intelligence report (automated)
- After evaluating a new tool/framework, extracting reusable patterns
