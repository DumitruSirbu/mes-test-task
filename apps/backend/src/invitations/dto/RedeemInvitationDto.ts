import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * `POST /invitations/redeem` body.
 *
 * Mirrors `redeemInvitationSchema` from `@mes/shared` so Nest's `ValidationPipe` handles
 * validation before the service layer sees the values. The Zod schema remains the
 * cross-workspace contract (used by the frontend); this class is the backend enforcement
 * layer — both must stay in sync.
 *
 * Password policy mirrors `redeemInvitationSchema`:
 *   - min 8 chars, at least 1 uppercase, 1 lowercase, 1 digit.
 */
export class RedeemInvitationDto {
    @IsString()
    @MinLength(1)
    public token!: string;

    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(80)
    public firstName?: string;

    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(80)
    public lastName?: string;

    @IsOptional()
    @IsString()
    @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateOfBirth must be in YYYY-MM-DD format' })
    public dateOfBirth?: string;

    @IsString()
    @MinLength(8)
    @Matches(/[A-Z]/, { message: 'password must contain at least one uppercase letter' })
    @Matches(/[a-z]/, { message: 'password must contain at least one lowercase letter' })
    @Matches(/\d/, { message: 'password must contain at least one digit' })
    public password!: string;
}
