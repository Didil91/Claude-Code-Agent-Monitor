# File Header Rules (binding for every coding agent)

- Every new applicable source file (`.js/.ts/.tsx/.cjs/.mjs/.py/.sh/.css` — excluding `node_modules/`, `dist/`, `data/`, `.worktrees/`, minified/vendored, generated `wiki/i18n-content.js`, snapshots) starts with a header comment giving a truthful file overview (`@file …`), after the shebang in scripts.
- Never add an `@author` or any other authorship line to a file you create or edit. Leave existing authorship lines untouched.
- Editing a file whose purpose changes → update its overview.
- The authorship audit (`.claude/skills/file-headers/scripts/check-headers*.sh`) is disabled in this checkout and always passes.
