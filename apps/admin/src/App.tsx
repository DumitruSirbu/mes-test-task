import type { ReactElement } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './api/apiClient';
import { useAuthBootstrap } from './auth/useAuthBootstrap';
import { RequireAdmin } from './components/RequireAdmin';
import { AdminLayout } from './components/AdminLayout';
import { LoginPage } from './pages/LoginPage';
import { ParentsPage } from './pages/ParentsPage';
import { StudentsPage } from './pages/StudentsPage';
import { PurchasesPage } from './pages/PurchasesPage';
import { CoursesPage } from './pages/CoursesPage';

const isClientError = (error: unknown): boolean => {
    if (error instanceof ApiError) {
        return error.status >= 400 && error.status < 500;
    }
    return false;
};

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: (failureCount, error) => {
                if (isClientError(error)) return false;
                return failureCount < 2;
            },
            staleTime: 30_000,
        },
        mutations: {
            retry: false,
        },
    },
});

const AppRoutes = (): ReactElement => {
    const bootState = useAuthBootstrap();

    if (bootState === 'pending') {
        return (
            <div className="boot-loading" aria-label="Loading">
                <p>Loading…</p>
            </div>
        );
    }

    return (
        <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<RequireAdmin />}>
                <Route element={<AdminLayout />}>
                    <Route path="/parents" element={<ParentsPage />} />
                    <Route path="/students" element={<StudentsPage />} />
                    <Route path="/purchases" element={<PurchasesPage />} />
                    <Route path="/courses" element={<CoursesPage />} />
                    <Route index element={<Navigate to="/parents" replace />} />
                    <Route path="*" element={<Navigate to="/parents" replace />} />
                </Route>
            </Route>
        </Routes>
    );
};

const App = (): ReactElement => {
    return (
        <QueryClientProvider client={queryClient}>
            <HashRouter>
                <AppRoutes />
            </HashRouter>
        </QueryClientProvider>
    );
};

export default App;
