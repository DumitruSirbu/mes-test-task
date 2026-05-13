import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * `POST /auth/login` body. The Zod schema in `@mes/shared/schemas/loginSchema` is the
 * cross-workspace contract; this class mirrors it so Nest's ValidationPipe handles
 * normalisation (trim + lowercase) before the service sees the value.
 */
export class LoginDto {
    @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
    @IsEmail()
    @MaxLength(255)
    public email!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(128)
    public password!: string;
}
