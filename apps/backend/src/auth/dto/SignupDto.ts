import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * `POST /auth/signup` body — parent self-signup only.
 *
 * `role` is intentionally NOT a field. The ValidationPipe runs with `forbidNonWhitelisted: true`,
 * so a client sending `role` gets a 400 VALIDATION_FAILED. Even if validation were bypassed,
 * `AuthService.signup` forces `UserRoleEnum.PARENT` regardless of input — defence in depth.
 *
 * Password policy (mirrors `signupSchema`):
 *   - 12–128 chars (max is a DoS guard against megabyte-sized argon2 inputs)
 *   - at least one letter and one digit
 */
export class SignupDto {
    @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
    @IsEmail()
    @MaxLength(255)
    public email!: string;

    @IsString()
    @MinLength(12, { message: 'Password must be at least 12 characters' })
    @MaxLength(128, { message: 'Password must be at most 128 characters' })
    @Matches(/[A-Za-z]/, { message: 'Password must contain at least one letter' })
    @Matches(/[0-9]/, { message: 'Password must contain at least one digit' })
    public password!: string;

    @IsOptional()
    @IsString()
    @MaxLength(80)
    public firstName?: string;

    @IsOptional()
    @IsString()
    @MaxLength(80)
    public lastName?: string;
}
