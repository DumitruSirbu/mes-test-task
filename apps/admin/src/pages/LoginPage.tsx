import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, UserRoleEnum } from '@mes/shared';
import type { IAuthTokenResponse, IAuthenticatedUser } from '@mes/shared';
import type { z } from 'zod';
import { apiRequest, ApiError } from '../api/apiClient';
import { authStore } from '../auth/authStore';

type LoginFormValues = z.infer<typeof loginSchema>;

interface IProfileResponse extends IAuthenticatedUser {
    email: string;
}

export const LoginPage = (): ReactElement => {
    const navigate = useNavigate();

    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<LoginFormValues>({
        resolver: zodResolver(loginSchema),
    });

    const onSubmit = async (values: LoginFormValues): Promise<void> => {
        try {
            const tokens = await apiRequest<IAuthTokenResponse>('/auth/login', { method: 'POST', body: values });
            const profile = await apiRequest<IProfileResponse>('/auth/me', { token: tokens.accessToken });

            if (profile.role !== UserRoleEnum.ADMIN) {
                setError('root', { message: 'Admin access only. Your account does not have admin privileges.' });
                return;
            }

            authStore.setState({
                accessToken: tokens.accessToken,
                userId: profile.id,
                role: profile.role,
                email: profile.email,
            });

            navigate('/parents');
        } catch (err) {
            const message = err instanceof ApiError ? err.message : 'Login failed. Please try again.';
            setError('root', { message });
        }
    };

    return (
        <div className="login-container">
            <div className="login-card">
                <h1>Admin Panel</h1>
                <p className="login-subtitle">MES Administration</p>
                <form onSubmit={(event) => void handleSubmit(onSubmit)(event)} noValidate>
                    <div className="field">
                        <label htmlFor="email">Email</label>
                        <input id="email" type="email" autoComplete="email" {...register('email')} />
                        {errors.email ? <p className="field-error" role="alert">{errors.email.message}</p> : null}
                    </div>
                    <div className="field">
                        <label htmlFor="password">Password</label>
                        <input id="password" type="password" autoComplete="current-password" {...register('password')} />
                        {errors.password ? <p className="field-error" role="alert">{errors.password.message}</p> : null}
                    </div>
                    {errors.root ? (
                        <div role="alert" className="error-block">
                            <p className="error-text">{errors.root.message}</p>
                        </div>
                    ) : null}
                    <button type="submit" className="btn btn-primary btn-full" disabled={isSubmitting}>
                        {isSubmitting ? 'Signing in…' : 'Sign in'}
                    </button>
                </form>
            </div>
        </div>
    );
};
