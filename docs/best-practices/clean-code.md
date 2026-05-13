# Clean Code

The team's authoritative rules live in [`code-conventions.md`](./code-conventions.md). They override generic Clean Code defaults where they conflict.

Generic Clean Code principles still apply where the conventions are silent:

- Names reveal intent.
- Functions do one thing at one level of abstraction.
- ≤2 arguments (group into DTOs if more).
- No flag (boolean) arguments — split into two functions.
- No dead code, no commented-out blocks.
- No magic numbers — extract named constants.
- Boy Scout Rule: leave every file slightly cleaner than you found it.

See `~/.claude/rules/clean-code.md` for the full Robert Martin rule set, applied as a fallback.
