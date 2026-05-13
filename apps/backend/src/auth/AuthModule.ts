import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { JwtModuleOptions } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import { UsersModule } from '../users/UsersModule';
import { AuthController } from './controller/AuthController';
import { AuthService } from './service/AuthService';
import { JwtStrategy } from './strategy/JwtStrategy';
import { DEFAULT_JWT_EXPIRES_IN } from './const/AuthConsts';
import { assertJwtConfig } from './util/assertJwtConfig';

/**
 * Wires JWT signing/verification + Passport strategy + the auth service surface.
 *
 * `JwtAuthGuard` and `RolesGuard` are NOT registered here — they're registered globally
 * in `AppModule` via `APP_GUARD` so no controller can forget to apply them.
 *
 * Algorithm pinning to HS256 is enforced both on signing (here) and verification
 * (`JwtStrategy`). See ADR 0003.
 */
@Module({
    imports: [
        UsersModule,
        PassportModule,
        JwtModule.registerAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService): JwtModuleOptions => {
                const secret = config.get<string>('JWT_SECRET');
                const expiresIn = config.get<string>('JWT_EXPIRES_IN') ?? DEFAULT_JWT_EXPIRES_IN;
                assertJwtConfig(secret, expiresIn);

                return {
                    secret,
                    signOptions: {
                        algorithm: 'HS256' as const,
                        // assertJwtConfig validated the format against JWT_EXPIRES_IN_REGEX,
                        // so the runtime value matches StringValue. The single `as` narrows
                        // from the wider `string` inferred by ConfigService to the branded
                        // template-literal union required by jsonwebtoken's SignOptions.
                        expiresIn: expiresIn as StringValue,
                    },
                    verifyOptions: {
                        algorithms: ['HS256' as const],
                    },
                } satisfies JwtModuleOptions;
            },
        }),
    ],
    controllers: [AuthController],
    providers: [AuthService, JwtStrategy],
    exports: [AuthService],
})
export class AuthModule {}
