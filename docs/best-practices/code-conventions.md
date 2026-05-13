---
description: Code style, naming conventions, entity/DTO/repository patterns, and testing guidelines. AUTHORITATIVE — overrides generic Clean Code defaults where they conflict.
globs: "apps/backend/src/**/*.ts"
alwaysApply: false
---

# Conventions

> These conventions are the team's strict rule set. Where they conflict with `~/.claude/rules/clean-code.md`, **these win**. The clean-code reviewer applies this file first.

## Formatting (Prettier)

- **Indent:** 4 spaces for `.ts`, `.js`, `.tsx`, `.json` files
- **Quotes:** single quotes for TS/JS/JSON
- **Print width:** 160 characters
- **Trailing commas:** always (`trailingComma: 'all'`)
- **Semicolons:** always
- **Arrow parens:** always (`(x) => ...`, not `x => ...`)

## TypeScript Config

- **Target:** ES2023, module: `nodenext`
- **Strict modes enabled:** `strictNullChecks`, `noImplicitAny`, `strictBindCallApply`
- **Decorators:** `experimentalDecorators` + `emitDecoratorMetadata` (required for NestJS DI)

## ESLint Rules

- `@typescript-eslint/no-explicit-any`: **off** (any is allowed)
- `@typescript-eslint/no-floating-promises`: **warn**
- `@typescript-eslint/no-unsafe-argument`: **warn**
- `import/no-extraneous-dependencies`: **error**
- Prettier integration enforced via `eslint-plugin-prettier`

## Naming Conventions

| Kind | Convention | Example |
|---|---|---|
| Files — classes | PascalCase | `JobDescriptionService.ts` |
| Files — interfaces | `I` prefix + PascalCase | `IJobDescription.ts` |
| Files — enums | PascalCase + `Enum` suffix | `ScorerTypeEnum.ts` |
| Files — constants | camelCase | `linkedinJobsConsts.ts` |
| Files — utils | camelCase | `normalizeStringValue.ts` |
| Classes | PascalCase | `JobDescriptionService` |
| Interfaces | `I` prefix | `IJobDescription`, `ICompany` |
| Enum declarations | PascalCase + `Enum` suffix | `ScorerTypeEnum` |
| Constants | UPPER_SNAKE_CASE | `LINKEDIN_JOBS_QUEUE` |
| Entity properties | camelCase | `jobExternalId` |
| DB columns | snake_case | `job_external_id` |

## Entity Rules

- Always set `@Entity({ name: 'snake_case_table', synchronize: false })` — schema is migration-driven
- PK: `@PrimaryGeneratedColumn({ name: '<table>_id' })` → auto-increment integer
- Column names: `snake_case` in DB, `camelCase` in TypeScript; always specify `name:`
- Always specify `type` in `@Column` (`'varchar'`, `'text'`, `'integer'`, `'bigint'`, `'date'`, `'timestamp'`, `'boolean'`, `'jsonb'`)
- Nullable columns: `{ nullable: true }` in decorator + TypeScript `?: string | null`
- JSON data: use PostgreSQL `jsonb` type, typed as `object | null` in TypeScript
- No TypeScript enums on entity columns; dimension values are separate lookup tables
- Timestamps: `created_at` / `updated_at` with `default: () => 'CURRENT_TIMESTAMP'` + `@BeforeInsert` / `@BeforeUpdate` hooks

### Entity Relations

- Use `@ManyToOne(() => RelatedEntity)` + `@JoinColumn({ name: 'fk_column', referencedColumnName: 'pkProperty' })`
- Always define BOTH the FK `@Column` (for direct id access) AND the `@ManyToOne` relation on the same DB column
- `referencedColumnName` uses the TypeScript property name, not the DB column name

### Entity Barrel

Every entity must be re-exported from its module's `entity/index.ts` and registered in the owning module's `TypeOrmModule.forFeature([...])`. Entities are **not** cross-registered — each module owns its own entities.

## DTO/Interface Naming

- Request DTOs: `<Action>RequestDto` or `<Entity><Action>Dto` (e.g., `ListPurchasesRequestDto`, `RedeemInvitationDto`)
- Response interfaces: `I<Entity>Response` or `I<Entity>Row`

## Repository Pattern

- One repository per entity; extends `BaseRepository<T>` (abstract, in `apps/backend/src/common/repository/BaseRepository.ts`)
- Injected via `@InjectRepository(Entity)` + passed to `super(repository)` in constructor
- Inherited methods: `findAll()`, `create()`, `insertManyIgnoreConflicts()` (protected)
- Domain-specific queries as public methods (e.g., `findWithFilters()`, `findLatest()`)
- Pattern for lookup repos: `findAllAndMap()` returns `Map<normalizedName, id>` for ETL FK resolution
- Pattern for bulk insert: deduplicate in-memory first, then call `insertManyIgnoreConflicts`
- No repository barrel file — import each repo by direct path

## Service Layer

- `*Service` — handles business logic, calls repositories and external services
- `*Gateway` — WebSocket handlers; emit events to clients
- Keep gateway logic light; complex state updates happen in services via gateway injection
- Use NestJS `Logger` (not `console.log`): `private readonly logger = new Logger(MyService.name)`
- `Promise.all` for parallel independent I/O
- Errors: log + rethrow in integration services, propagation in domain services

## NestJS Patterns

### Dependency Injection

```typescript
@Injectable()
export class MyService {
    constructor(
        private readonly someRepository: SomeRepository,
        private readonly otherService: OtherService,
        @InjectQueue(QUEUE_NAME) private readonly queue: Queue,
    ) {}
}
```

- Always use `private readonly` for injected dependencies
- Custom injection tokens: `@Inject('TOKEN_NAME')` for factory providers
- BullMQ: `@InjectQueue(QUEUE_NAME)` with queue name from const

### Module Registration

```typescript
@Module({
    imports: [
        TypeOrmModule.forFeature([Entity1, Entity2, ...]),
        BullModule.registerQueue({ name: QUEUE_NAME }),
        OtherModule,
    ],
    controllers: [MyController],
    providers: [MyService, MyRepository, MyProcessor],
})
export class MyModule {}
```

### Controllers

- Routes: `@Controller('resource-name')` with kebab-case paths
- Methods: use standard HTTP verbs (`@Get`, `@Post`, `@Patch`, `@Delete`)
- DTOs for all validated inputs — both `@Body()` and `@Query()`; always use `class-validator` decorators
- Extend `PaginationDto` for paginated query params
- `@Post` endpoints that return data (not 201) should use `@HttpCode(HttpStatus.OK)`
- `@Delete` endpoints returning nothing should use `@HttpCode(HttpStatus.NO_CONTENT)`

Example with body:

```typescript
@Post('redeem-invitation')
@HttpCode(HttpStatus.OK)
async redeemInvitation(@Body() body: RedeemInvitationDto): Promise<IInvitationRedemptionResponse> {
    return this.service.redeem(body.token, body.password);
}
```

### Authentication

- Global `JwtAuthGuard` is applied via `APP_GUARD` in `AppModule` — do NOT add `@UseGuards` on individual controllers
- Mark public routes with `@Public()` (imported from `src/module/auth/decorator/Public`):

```typescript
@Public()
@Post('login')
@HttpCode(HttpStatus.OK)
async login(@Body() body: LoginDto): Promise<ITokenResponse> { ... }
```

### Queue Processors

```typescript
@Processor(QUEUE_NAME, {
    lockDuration: 10 * 60 * 1000,  // 10 minutes for long-running jobs
    stalledInterval: 30 * 1000,
    maxStalledCount: 1,
    concurrency: 2,
})
export class MyProcessor extends WorkerHost {
    private readonly logger = new Logger(MyProcessor.name);

    constructor(private readonly service: MyService) { super(); }

    async process(job: Job<PayloadType>): Promise<void> { ... }

    @OnWorkerEvent('completed')
    onCompleted(job: Job) { this.logger.log(`Done: ${job.id}`); }

    @OnWorkerEvent('failed')
    onFailed(job: Job, error: Error) { this.logger.error(`Failed: ${job.id}`, error.message); }
}
```

## Control flow & spacing

- Every loop and conditional body MUST use braces, even when the body is a single statement. Forbidden: `if (x) doThing();`, `for (...) doThing();`. Required: `if (x) { doThing(); }`. Applies to `if`, `else`, `else if`, `for`, `for...of`, `for...in`, `while`, `do...while`.
- A blank line MUST appear BEFORE and AFTER every `if`, `for`, `while`, and `switch` block. Exception: when the block is the first or last statement of its enclosing block, only the adjacent inner side requires a blank line.
- A blank line MUST appear BEFORE every `return` statement. Exception: when the `return` is the only statement in its block.
- **Reviewers MUST flag any violation as must-fix.**

Example:

**Before (forbidden):**
```typescript
async findUserWithOrders(userId: string): Promise<IUser | null> {
    if (!userId) return null;
    const user = await this.repository.findOne(userId);
    if (!user) return null;
    user.orders = this.orders.filter(o => o.userId === userId);
    for (const order of user.orders) order.total = order.items.reduce((sum, i) => sum + i.price, 0);
    return user;
}
```

**After (required):**
```typescript
async findUserWithOrders(userId: string): Promise<IUser | null> {

    if (!userId) {
        return null;
    }

    const user = await this.repository.findOne(userId);

    if (!user) {
        return null;
    }

    user.orders = this.orders.filter(o => o.userId === userId);

    for (const order of user.orders) {
        order.total = order.items.reduce((sum, i) => sum + i.price, 0);
    }

    return user;
}
```

## Type assertions

- Prefer `satisfies` over `as`. Use `satisfies` whenever you want to check a value conforms to a type without widening it.
- Use `as` ONLY when the runtime type is genuinely narrower than the inferred type — e.g., `JSON.parse` results, narrowing from `unknown`, branded-type construction at a controlled boundary.
- Forbidden: `as unknown as X` double-casts. Refactor the underlying types instead.

Example:

**Before (using `as`):**
```typescript
const config = {
    host: 'localhost',
    port: 5432,
    timeout: 3000,
} as IConfig;  // Widens the type; later additions won't be caught as config errors.
```

**After (using `satisfies`):**
```typescript
const config = {
    host: 'localhost',
    port: 5432,
    timeout: 3000,
} satisfies IConfig;  // Checks shape at definition; retains literal type { host, port, timeout }.
```

Use `as` only for narrowing unknown or third-party types:
```typescript
const parsed = JSON.parse(jsonString) as Record<string, unknown>;
const element = document.getElementById('btn') as HTMLButtonElement;
```

## Barrel Exports

Each subfolder (`entity/`, `interface/`, `const/`, `utils/`, `controller/`, `service/`, `enum/`) has an `index.ts` that re-exports all public members. Keep it updated when adding new files. **Exceptions:** `repository/` and `dto/` have no barrel — import each directly.

### Enum Placement

- Place enums in the module `enum/` folder, not in `interface/` files
- Enum file names must use `Enum` suffix (e.g. `ScorerTypeEnum.ts`)
- Enum type names must use `Enum` suffix (e.g. `ScorerTypeEnum`)
- Cross-workspace enums (consumed by frontend too) live in `packages/shared/src/enums/` with the same naming

## Constants Placement

**AUTHORITATIVE:** Every constant (numeric literal, string literal, regex, default config value) that is not strictly local to one function MUST live in a `const/` folder of its module.

- **File path pattern:** `apps/backend/src/<domain>/const/<Domain>Consts.ts` (e.g., `apps/backend/src/auth/const/AuthConsts.ts`, `apps/backend/src/common/const/CommonConsts.ts`)
- **File naming:** `<Domain>Consts.ts` (PascalCase domain prefix, `Consts` suffix)
- **Export names:** `UPPER_SNAKE_CASE` for all constants
- **Barrel:** Each module with a `const/` folder exports from `const/index.ts`
- **Forbidden:** top-of-file `const FOO = ...` constants exported alongside services/controllers/entities
- **Forbidden:** inline magic numbers, magic strings, or regex literals in code
- **Reviewer enforcement:** `mes-review-clean-code` MUST flag any violation as must-fix

Example structure:
```
apps/backend/src/auth/
├── const/
│   ├── AuthConsts.ts           # AUTH_QUEUE_NAME, JWT_EXPIRY_SECONDS, etc.
│   └── index.ts                # exports from AuthConsts
├── service/
├── controller/
└── ...
```

Example constants file:
```typescript
// AuthConsts.ts
export const AUTH_QUEUE_NAME = 'auth-queue';
export const JWT_EXPIRY_SECONDS = 3600;
export const PASSWORD_MIN_LENGTH = 8;
export const THROTTLE_LIMIT = 5;
```

## Error Handling

- **Integration calls (external APIs):** `try/catch` → log with context → rethrow original error
- **Domain services:** let errors propagate naturally
- **Duplicate key on insert:** catch, inspect `error.message` for `'duplicate key'` or `'unique constraint'`, log warn and return (no rethrow)
- **Global filter:** `AllExceptionsFilter` produces the canonical JSON error shape (`{ code, message, requestId, details }`) — see ADR 0005

## Migration Rules

- **File naming:** `YYYYMMDDHHMMSS-<DescriptiveName>.ts` (e.g., `20260513090800-CreatePurchasesTable.ts`)
- **Class naming:** `<DescriptiveName><Timestamp> implements MigrationInterface`
- **Table creation:** `new Table({ name, columns })` + `queryRunner.createTable(table, true)`
- **Foreign keys:** `new TableForeignKey({ name: 'FK_<table>_<column>', ... })` + `queryRunner.createForeignKeys`
- **Indexes:** `new TableIndex({ name: 'IDX_<table>_<column>[_unique]', ... })` + `queryRunner.createIndices`
- **`down()` must reverse in exact opposite order:** drop indexes (reverse) → drop FKs (reverse) → drop table
- **onDelete policy:** RESTRICT for required lookups, SET NULL for optional FKs, CASCADE for dependent child rows
- **onUpdate:** always CASCADE
- **Migrations transaction mode:** `each` (each migration in its own transaction)

## Testing Patterns

- Unit tests use `jest` with mocks for repositories/services
- Integration tests run against a test database
- Use factory functions to seed test data
- Test file location mirrors source under `__tests__/` (e.g., `service/PurchaseService.ts` → `service/__tests__/PurchaseService.spec.ts`)

## Milestone Closure & Review Loop

**AUTHORITATIVE workflow for closing every milestone: two mandatory review rounds.**

**Round 1:**
1. After implementation + QA complete, the `mes-orchestrator` dispatches all three reviewers in parallel:
   - `mes-review-security` → checks auth, data leaks, secrets, access control
   - `mes-review-logic` → checks domain invariants, state machines, error cases
   - `mes-review-clean-code` → checks naming, function length, constants placement, control flow, DRY, test coverage

2. For every `blocker` or `high` finding: the orchestrator dispatches the relevant specialist (backend, shared, frontend, or devops) to fix it.
3. For every `medium` finding: fix only if cheap to do; otherwise defer to next round or next milestone.
4. Document each fix in `docs/work-log.md` with a new row (same milestone ID, `Round 1 Fix N` suffix).

**Round 2:**
5. Dispatch all three reviewers in parallel again.
6. For every remaining `blocker` or `high` finding: must fix before round 2 closes.
7. For every remaining `medium` finding: document as a carry-over to the next milestone (bullet in the milestone's "Review rounds" section).
8. Document round 2 outcome in `docs/work-log.md` with a final row (milestone ID, `Round 2` suffix).

**Milestone completion:**
9. After round 2, milestone is marked **done** — no blockers/highs remain.
10. Further iterations beyond round 2 are **optional**, not mandatory.
11. Scribe updates `milestones/M<N>-*.md` with a "Review rounds" section (round 1 fixes, round 2 fixes, medium carry-overs).
12. Scribe updates the milestone pointer in `CLAUDE.md`.

**Why:** Two rounds catch most mistakes without unbounded iteration; mediums are tracked explicitly to prevent silent debt.
Blockers/highs are always must-fix; mediums are accepted into the next milestone if the fix is costly.

## Build & lint gate

**AUTHORITATIVE:** Every implementer (backend, frontend, shared, devops) MUST enforce zero-defect build + lint before handing off to review.

- **Required pre-handoff checks:** `pnpm --filter <workspace> build` AND `pnpm --filter <workspace> lint` (and `tsc --noEmit` where it differs from build) must both pass.
- **Acceptance criteria:** Zero TypeScript errors and zero lint errors. Warnings must be fixed unless explicitly documented as accepted with a one-line justification comment in the code.
- **No suppressions as a fix:** `eslint-disable`, `@ts-ignore`, or `as any` are forbidden as workarounds. Suppressions are allowed ONLY at genuine boundaries (third-party untyped imports, `JSON.parse` results) and MUST include a one-line comment explaining why.
- **Orchestrator gate:** Before triggering the milestone-close reviewer loop, `mes-orchestrator` MUST verify build + lint are clean. If a reviewer later flags a build/lint regression, that counts as a **high** finding.

**Why:** Build/lint failures are the first line of defense against silent bugs and type unsafety. Zero tolerance ensures reviews can focus on logic and design, not chasing compile errors.

## See also

- [docs/architecture/overview.md](../architecture/overview.md) — module structure and design patterns
- [docs/architecture/adr/](../architecture/adr/) — Architecture Decision Records
- [README.md](../../README.md) — setup and dev commands
