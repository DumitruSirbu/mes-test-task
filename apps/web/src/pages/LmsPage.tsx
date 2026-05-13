import { useEffect, type ReactElement } from 'react';
import { UserRoleEnum } from '@mes/shared';
import { useAuth } from '../auth/authStore';
import { navigate } from '../router/router';

export const LmsPage = (): ReactElement => {
    const auth = useAuth();

    useEffect(() => {
        if (!auth || auth.role !== UserRoleEnum.STUDENT) {
            navigate('/login');
        }
    }, [auth]);

    if (!auth || auth.role !== UserRoleEnum.STUDENT) {
        return <div className="page"><p>Redirecting…</p></div>;
    }

    return (
        <div className="page">
            <h1>Welcome to the LMS</h1>
            <p>Logged in as <strong>{auth.email}</strong></p>
        </div>
    );
};
