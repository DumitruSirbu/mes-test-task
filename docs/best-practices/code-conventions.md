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

## Barrel Exports

Each subfolder (`entity/`, `interface/`, `const/`, `utils/`, `controller/`, `service/`, `enum/`) has an `index.ts` that re-exports all public members. Keep it updated when adding new files. **Exceptions:** `repository/` and `dto/` have no barrel — import each directly.

### Enum Placement

- Place enums in the module `enum/` folder, not in `interface/` files
- Enum file names must use `Enum` suffix (e.g. `ScorerTypeEnum.ts`)
- Enum type names must use `Enum` suffix (e.g. `ScorerTypeEnum`)
- Cross-workspace enums (consumed by frontend too) live in `packages/shared/src/enums/` with the same naming

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

## See also

- [docs/architecture/overview.md](../architecture/overview.md) — module structure and design patterns
- [docs/architecture/adr/](../architecture/adr/) — Architecture Decision Records
- [README.md](../../README.md) — setup and dev commands
