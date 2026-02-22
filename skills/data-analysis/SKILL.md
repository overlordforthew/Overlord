# Skill: Data Analysis

## Scope
Process CSVs, analyze data, generate charts and reports.

## Available Tools

### analyze.py
Load and analyze CSV/JSON data files.
```bash
python3 /app/skills/data-analysis/analyze.py data.csv                    # Summary statistics
python3 /app/skills/data-analysis/analyze.py data.csv --columns name,age  # Specific columns
python3 /app/skills/data-analysis/analyze.py data.csv --filter "age>30"   # Filter rows
python3 /app/skills/data-analysis/analyze.py data.csv --sort price --desc # Sort by column
python3 /app/skills/data-analysis/analyze.py data.csv --top 10            # First N rows
python3 /app/skills/data-analysis/analyze.py data.json                    # Also handles JSON
```

### chart.py
Generate charts from data (saves as PNG).
```bash
python3 /app/skills/data-analysis/chart.py data.csv --type bar --x name --y sales --output chart.png
python3 /app/skills/data-analysis/chart.py data.csv --type line --x date --y price --output trend.png
python3 /app/skills/data-analysis/chart.py data.csv --type pie --x category --y count --output dist.png
```

## When to Use
- User shares a CSV or JSON file to analyze
- User asks for charts or visualizations
- Need to process, filter, or summarize data
- Comparing numbers, finding trends, calculating statistics
