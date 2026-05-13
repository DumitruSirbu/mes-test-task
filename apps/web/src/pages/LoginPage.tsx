import { useState, type FormEvent, type ReactElement } from 'react';
import { UserRoleEnum, loginSchema } from '@mes/shared';
import type { IAuthenticatedUser } from '@mes/shared';
import { apiRequest, ApiError } from '../api/apiClient';
import { authStore } from '../auth/authStore';
import { navigate } from '../router/router';

interface ITokenResponse {
    accessToken: string;
    expiresIn: number;
}

interface IProfileResponse extends IAuthenticatedUser {
    email: string;
}

/**
 * Parent login. Only PARENT users can reach the purchase flow; STUDENT / ADMIN are
 * redirected to a holding screen since their journeys aren't part of M04.
 */
export const LoginPage = (): ReactElement => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const onSubmit = async (event: FormEvent): Promise<void> => {
        event.preventDefault();
        setError(null);

        const parsed = loginSchema.safeParse({ email, password });

        if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? 'Invalid credentials.');

            return;
        }

        setSubmitting(true);

        try {
            const tokens = await apiRequest<ITokenResponse>('/auth/login', { method: 'POST', body: parsed.data });
            const profile = await apiRequest<IProfileResponse>('/auth/me', { token: tokens.accessToken });

            authStore.setState({
                accessToken: tokens.accessToken,
                userId: profile.id,
                role: profile.role,
                email: profile.email,
            });

            if (profile.role === UserRoleEnum.PARENT) {
                navigate('/courses');
            } else {
                navigate('/');
            }
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Login failed.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="page">
            <h1>Log in</h1>
            <form onSubmit={(event) => void onSubmit(event)}>
                <label>
                    Email
                    <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
                </label>
                <label>
                    Password
                    <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
                </label>
                <button type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Log in'}</button>
            </form>
            {error ? <p role="alert" className="error">{error}</p> : null}
            <p className="page-center">
                No account? <a href="#/signup">Sign up as a parent</a>
            </p>
        </div>
    );
};
