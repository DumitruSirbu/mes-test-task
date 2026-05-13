# Git Workflow

## Branching

- `main` — always green, deployable.
- Feature branches: `mNN/<short-slug>` (e.g., `m03/auth-rbac`). One branch per milestone or per significant sub-task.

## Commits

- Conventional-ish: `<type>: <subject>` — `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `ci`, `build`.
- Subject in present tense, ≤72 chars, no trailing period.
- Body: explain the WHY when non-obvious.

## PR rules (if used)

- Title mirrors the commit subject.
- Body links the milestone file and notes the reviewers' findings.
- CI must be green before merge.

## Hooks

- Pre-commit (via husky + lint-staged in future): Prettier + ESLint on staged files. Out of scope for v1; manual `pnpm format` + `pnpm lint` before commit.
