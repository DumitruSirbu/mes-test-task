import { useState, type FormEvent, type ReactElement } from 'react';
import { UserRoleEnum, signupSchema } from '@mes/shared';
import { apiRequest, ApiError } from '../api/apiClient';
import { authStore } from '../auth/authStore';
import { navigate } from '../router/router';

interface ITokenResponse {
    accessToken: string;
    expiresIn: number;
}

interface IProfileResponse {
    id: number;
    email: string;
    role: UserRoleEnum;
}

/**
 * Parent self-signup. The backend forces `role = PARENT` regardless of input — the UI
 * doesn't expose a role picker for that exact reason (see SignupDto rationale).
 */
export const SignupPage = (): ReactElement => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const onSubmit = async (event: FormEvent): Promise<void> => {
        event.preventDefault();
        setError(null);

        const parsed = signupSchema.safeParse({ email, password });

        if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? 'Invalid input.');

            return;
        }

        setSubmitting(true);

        try {
            const tokens = await apiRequest<ITokenResponse>('/auth/signup', { method: 'POST', body: parsed.data });
            const profile = await apiRequest<IProfileResponse>('/auth/me', { token: tokens.accessToken });

            authStore.setState({
                accessToken: tokens.accessToken,
                userId: profile.id,
                role: profile.role,
                email: profile.email,
            });
            navigate('/courses');
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Signup failed.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="page">
            <h1>Create your parent account</h1>
            <form onSubmit={(event) => void onSubmit(event)}>
                <label>
                    Email
                    <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
                </label>
                <label>
                    Password (12+ chars, letters and digits)
                    <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
                </label>
                <button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Sign up'}</button>
            </form>
            {error ? <p role="alert" className="error">{error}</p> : null}
            <p>
                Already have an account? <a href="#/login">Log in</a>
            </p>
        </div>
    );
};
