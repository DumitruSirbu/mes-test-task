import type { ReactElement } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { UserRoleEnum } from '@mes/shared';
import { useAuth } from '../auth/authStore';

/**
 * Route guard that allows only authenticated ADMIN users through.
 * Unauthenticated visitors are redirected to /login.
 * Authenticated non-admin users see a clear denial message — they are not redirected
 * to login because they are already signed in with a valid but insufficient role.
 */
export const RequireAdmin = (): ReactElement => {
    const auth = useAuth();

    if (!auth) {
        return <Navigate to="/login" replace />;
    }

    if (auth.role !== UserRoleEnum.ADMIN) {
        return (
            <div className="access-denied">
                <h1>Admin access only</h1>
                <p>Your account ({auth.email}) does not have admin privileges.</p>
            </div>
        );
    }

    return <Outlet />;
};
