#!/usr/bin/env python3
"""
Prompt Guard wrapper for Overlord.

Reads message from stdin, runs prompt-guard analysis or output sanitization,
outputs JSON to stdout. Fully offline (no API, no HiveFence).

Usage:
  echo "message" | python3 guard.py --mode input --sensitivity medium
  echo "response" | python3 guard.py --mode output --sensitivity medium
"""

import sys
import json
import argparse

# prompt-guard is installed as a skill, add its path
sys.path.insert(0, '/app/skills/prompt-guard')

from prompt_guard import PromptGuard


def main():
    parser = argparse.ArgumentParser(description='Prompt Guard wrapper')
    parser.add_argument('--mode', choices=['input', 'output'], default='input')
    parser.add_argument('--sensitivity', default='medium',
                        choices=['low', 'medium', 'paranoid'])
    parser.add_argument('--user-id', default='unknown')
    parser.add_argument('--is-group', action='store_true')
    args = parser.parse_args()

    text = sys.stdin.read()
    if not text.strip():
        json.dump({'severity': 'SAFE', 'action': 'allow', 'reasons': []}, sys.stdout)
        return

    guard = PromptGuard(config={
        'sensitivity': args.sensitivity,
        'api': {'enabled': False},
        'hivefence': {'enabled': False},
        'logging': {'enabled': False},
        'rate_limit': {'enabled': False},
    })

    if args.mode == 'input':
        result = guard.analyze(text, context={
            'user_id': args.user_id,
            'is_group': args.is_group,
        })
        json.dump({
            'severity': result.severity.name,
            'action': result.action.value,
            'reasons': result.reasons,
            'patternsMatched': len(result.patterns_matched),
        }, sys.stdout)
    else:
        result = guard.sanitize_output(text)
        json.dump({
            'blocked': result.blocked,
            'wasModified': result.was_modified,
            'sanitizedText': result.sanitized_text,
            'redactionCount': result.redaction_count,
            'redactedTypes': result.redacted_types,
        }, sys.stdout)


if __name__ == '__main__':
    main()
