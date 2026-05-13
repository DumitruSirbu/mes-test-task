import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { IAuthenticatedUser } from '@mes/shared';
import { Public } from '../decorator/Public';
import { CurrentUser } from '../decorator/CurrentUser';
import { LoginDto } from '../dto/LoginDto';
import { SignupDto } from '../dto/SignupDto';
import { IAuthTokenResponse } from '../interface/IAuthTokenResponse';
import { IAuthUserProfile } from '../interface/IAuthUserProfile';
import { AuthService } from '../service/AuthService';

/**
 * `/auth/*` routes — both `signup` and `login` are `@Public()`; `/auth/me` requires a
 * valid bearer token (any role). Role gating for downstream endpoints lives on those
 * endpoints, not here.
 */
@Controller('auth')
export class AuthController {
    public constructor(private readonly authService: AuthService) {}

    @Public()
    @Post('signup')
    @HttpCode(HttpStatus.CREATED)
    public async signup(@Body() body: SignupDto): Promise<IAuthTokenResponse> {
        return this.authService.signup(body);
    }

    @Public()
    @Post('login')
    @HttpCode(HttpStatus.OK)
    public async login(@Body() body: LoginDto): Promise<IAuthTokenResponse> {
        return this.authService.login(body);
    }

    @Get('me')
    public async me(@CurrentUser() user: IAuthenticatedUser): Promise<IAuthUserProfile> {
        return this.authService.getProfile(user.id);
    }
}
