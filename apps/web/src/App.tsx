import type { ReactElement } from 'react';
import { UserRoleEnum } from '@mes/shared';
import { authStore, useAuth } from './auth/authStore';
import { matchRoute, navigate, useRoutePath } from './router/router';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { CoursesPage } from './pages/CoursesPage';
import { CourseDetailPage } from './pages/CourseDetailPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { CheckoutSuccessPage } from './pages/CheckoutSuccessPage';
import './App.css';

/**
 * Hash-route table. Order matters only for matching specificity — each pattern is unique
 * here. The parent-only routes (`/checkout/*`) are gated inside the page components via
 * the auth store; an unauthenticated visitor is redirected to `/login`.
 */
const renderRoute = (path: string): ReactElement => {
    const checkoutMatch = matchRoute('/checkout/:courseId', path);

    if (path === '/checkout/success') {
        return <CheckoutSuccessPage />;
    }

    if (checkoutMatch) {
        return <CheckoutPage courseId={checkoutMatch.params.courseId} />;
    }

    const courseDetailMatch = matchRoute('/courses/:id', path);

    if (courseDetailMatch) {
        return <CourseDetailPage courseId={courseDetailMatch.params.id} />;
    }

    if (path === '/courses') {
        return <CoursesPage />;
    }

    if (path === '/login') {
        return <LoginPage />;
    }

    if (path === '/signup') {
        return <SignupPage />;
    }

    return <CoursesPage />;
};

const App = (): ReactElement => {
    const path = useRoutePath();
    const auth = useAuth();

    const onLogout = (): void => {
        authStore.clear();
        navigate('/courses');
    };

    return (
        <div className="app">
            <header className="header">
                <a href="#/courses" className="brand">MES</a>
                <nav>
                    {auth ? (
                        <>
                            <span>{auth.email}</span>
                            {auth.role === UserRoleEnum.PARENT ? <span className="role-badge">Parent</span> : null}
                            <button type="button" onClick={onLogout}>Log out</button>
                        </>
                    ) : (
                        <>
                            <a href="#/login">Log in</a>
                            <a href="#/signup">Sign up</a>
                        </>
                    )}
                </nav>
            </header>
            <main>{renderRoute(path)}</main>
        </div>
    );
};

export default App;
