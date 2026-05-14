import type { ReactElement } from 'react';
import { UserRoleEnum } from '@mes/shared';
import { authStore, useAuth } from './auth/authStore';
import { useAuthBootstrap } from './auth/useAuthBootstrap';
import { postLogoutWithRetry } from './auth/logoutClient';
import { matchRoute, navigate, useRoutePath } from './router/router';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { CoursesPage } from './pages/CoursesPage';
import { CourseDetailPage } from './pages/CourseDetailPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { CheckoutSuccessPage } from './pages/CheckoutSuccessPage';
import { OnboardPage } from './pages/OnboardPage';
import { LmsPage } from './pages/LmsPage';
import { LmsCourseDetailPage } from './pages/LmsCourseDetailPage';
import { LmsLessonPage } from './pages/LmsLessonPage';
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

    const onboardMatch = matchRoute('/onboard/:token', path);

    if (onboardMatch) {
        return <OnboardPage token={onboardMatch.params.token} />;
    }

    const lmsLessonMatch = matchRoute('/lms/lessons/:lessonId', path);

    if (lmsLessonMatch) {
        return <LmsLessonPage lessonId={lmsLessonMatch.params.lessonId} />;
    }

    const lmsCourseMatch = matchRoute('/lms/courses/:id', path);

    if (lmsCourseMatch) {
        return <LmsCourseDetailPage courseId={lmsCourseMatch.params.id} />;
    }

    if (path === '/lms') {
        return <LmsPage />;
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
    const bootState = useAuthBootstrap();
    const path = useRoutePath();
    const auth = useAuth();

    if (bootState === 'pending') {
        return (
            <div className="app">
                <p aria-label="Loading">Loading…</p>
            </div>
        );
    }

    const handleLogout = (): void => {
        // Set flag before the network call so the in-flight refresh guard sees it.
        authStore.setIsLoggingOut(true);

        void postLogoutWithRetry().finally(() => {
            authStore.clear();
            authStore.setIsLoggingOut(false);
            navigate('/courses');
        });
    };

    return (
        <div className="app">
            <header className="header">
                <a href="#/courses" className="brand">MES</a>
                <nav>
                    {auth ? (
                        <>
                            {auth.role === UserRoleEnum.STUDENT ? <a href="#/lms">My Courses</a> : null}
                            <span>{auth.email}</span>
                            {auth.role === UserRoleEnum.PARENT ? <span className="role-badge">Parent</span> : null}
                            <button type="button" onClick={handleLogout}>Log out</button>
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
