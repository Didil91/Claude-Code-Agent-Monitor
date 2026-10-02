---
name: file-headers
description: For every coding agent (Claude Code, Codex, or any other) writing a new source file in this repository — start it with a short header comment giving a truthful file overview. Never add an @author or other authorship line. Covers JS/TS/TSX/CJS/MJS, Python, shell, and CSS.
---

# File Headers — File Overview Only

Every new applicable source file starts with a header comment that gives a
truthful **file overview**. Do **not** add an `@author` line or any other
authorship attribution, and leave existing authorship lines untouched.

## Formats

JS / TS / TSX / CJS / MJS / CSS:

```
/**
 * @file Short, truthful description of what this file does.
 */
```

Python / shell (after the shebang, if any):

```
# @file Short, truthful description of what this file does.
```

## Rules

1. **Truthful overview.** Describe what the file actually does; update it when an
   edit changes the file's purpose.
2. **No authorship lines.** Never write `@author`, copyright owners or emails.
3. **Excluded:** `node_modules/`, `dist/`, `data/`, `.worktrees/`, minified or
   vendored files, generated `wiki/i18n-content.js`, snapshots.

The authorship audit scripts in `scripts/` are disabled in this checkout and
always pass.
