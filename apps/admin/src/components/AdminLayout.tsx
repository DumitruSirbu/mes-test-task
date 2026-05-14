import type { ReactElement } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth, authStore } from '../auth/authStore';
import { postLogoutWithRetry } from '../auth/logoutClient';

const NAV_LINKS = [
    { to: '/parents', label: 'Parents' },
    { to: '/students', label: 'Students' },
    { to: '/purchases', label: 'Purchases' },
    { to: '/courses', label: 'Courses' },
] as const;

export const AdminLayout = (): ReactElement => {
    const auth = useAuth();
    const navigate = useNavigate();

    const handleLogout = (): void => {
        // Set flag before the network call so the in-flight refresh guard sees it.
        authStore.setIsLoggingOut(true);

        void postLogoutWithRetry().finally(() => {
            authStore.clear();
            authStore.setIsLoggingOut(false);
            navigate('/login');
        });
    };

    return (
        <div className="admin-layout">
            <aside className="sidebar">
                <div className="sidebar-brand">MES Admin</div>
                <nav className="sidebar-nav">
                    {NAV_LINKS.map(({ to, label }) => (
                        <NavLink
                            key={to}
                            to={to}
                            className={({ isActive }) => `sidebar-link${isActive ? ' sidebar-link--active' : ''}`}
                        >
                            {label}
                        </NavLink>
                    ))}
                </nav>
                <div className="sidebar-footer">
                    <span className="sidebar-email">{auth?.email}</span>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={handleLogout}>
                        Log out
                    </button>
                </div>
            </aside>
            <main className="admin-main">
                <Outlet />
            </main>
        </div>
    );
};
