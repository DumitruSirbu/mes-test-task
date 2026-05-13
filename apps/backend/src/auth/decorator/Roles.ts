import { SetMetadata } from '@nestjs/common';
import { UserRoleEnum } from '@mes/shared';

/**
 * Allowed-role list for a handler. Empty / unset metadata means "any authenticated user".
 * Read by `RolesGuard`.
 */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRoleEnum[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);
