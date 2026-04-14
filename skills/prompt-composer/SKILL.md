---
name: prompt-composer
description: Compose complex prompts from reusable blocks with conditional logic, whitespace normalization, and structured formatting. Use when building multi-section prompts, conditionally including sections, or templating prompt content.
trigger: prompt composition, building prompts, conditional prompts, prompt template, structured prompt
---

# Prompt Composer

Utilities for building structured prompts from reusable blocks. Extracted from moeru-ai/airi (34k stars).

## Core Functions

### div(...sections) — Section Composer
Joins sections with double newlines. Handles strings, arrays, and null values gracefully.

```javascript
function div(...args) {
  const results = [];
  for (const arg of args) {
    if (arg == null) continue;
    if (typeof arg === 'string') results.push(arg);
    else if (Array.isArray(arg)) results.push(div(...arg));
    else results.push(arg.text);
  }
  return results.join('\n\n');
}
```

### span(...phrases) — Inline Composer
Joins phrases into a single line, trimming whitespace and normalizing newlines. Useful for multi-line template literals that should render as one paragraph.

```javascript
function span(...args) {
  return args
    .map(arg => arg.trim())
    .map(arg => arg.replaceAll(/\n\s+/g, ''))
    .map(arg => arg.replaceAll(/\r\s+/g, ' '))
    .join(' ');
}
```

### vif(condition, ifTrue, ifFalse) — Conditional Include
Include a prompt section only when a condition is true.

```javascript
function vif(condition, a, b = '') {
  return condition ? a : b;
}
```

### vChoice(...[condition, value]) — Multi-Conditional
Returns the value of the first truthy condition. Like a switch statement for prompt sections.

```javascript
function vChoice(...args) {
  for (const [condition, value] of args) {
    if (typeof condition === 'function' ? condition() : condition) {
      return value;
    }
  }
  return '';
}
```

### ul(...items) — List Formatter
```javascript
function ul(...args) {
  return args.map(arg => `- ${arg}`).join('\n');
}
```

## Usage Pattern

```javascript
const prompt = div(
  'You are a helpful assistant.',
  vif(hasContext, div(
    'Context:',
    ul(...contextItems),
  )),
  span(`
    The current time is ${new Date().toISOString()}.
    Please respond in ${language}.
  `),
  vChoice(
    [isUrgent, 'PRIORITY: This is urgent. Respond immediately.'],
    [isImportant, 'This is important but not urgent.'],
  ),
  'Based on the above, please help the user.',
);
```

## When to Use
- Building skill prompts with optional sections
- Composing system prompts from multiple sources
- Conditional prompt sections based on runtime state
- Normalizing multiline template literals into clean paragraphs
