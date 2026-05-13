import { IsEmail, IsInt, IsPositive, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * `POST /purchases` body. Mirrors `@mes/shared/schemas/createPurchaseSchema` so the
 * Nest ValidationPipe rejects malformed bodies before the service is reached.
 */
export class CreatePurchaseDto {
    @IsInt()
    @IsPositive()
    public courseId!: number;

    @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
    @IsEmail()
    @MaxLength(255)
    public studentEmail!: string;
}
