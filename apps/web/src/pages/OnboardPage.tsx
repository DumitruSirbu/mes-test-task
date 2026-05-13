import { useEffect, useState, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { redeemInvitationSchema, InvitationStatusEnum } from '@mes/shared';
import type { IInvitationMetaResponse } from '@mes/shared';
import { fetchInvitationMeta, redeemInvitation } from '../api/invitationsApi';
import { ApiError } from '../api/apiClient';
import { authStore } from '../auth/authStore';
import { decodeJwtPayload } from '../auth/decodeJwtPayload';
import { navigate } from '../router/router';

interface IProps {
    token: string;
}

const onboardFormSchema = redeemInvitationSchema
    .extend({ confirmPassword: z.string().min(1, 'Please confirm your password') })
    .superRefine((data, context) => {
        if (data.password !== data.confirmPassword) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Passwords do not match',
                path: ['confirmPassword'],
            });
        }
    });

type OnboardFormValues = z.infer<typeof onboardFormSchema>;

const INVITATION_EMAIL_CONFLICT_CODE = 'INVITATION_EMAIL_CONFLICT';

export const OnboardPage = ({ token }: IProps): ReactElement => {
    const [meta, setMeta] = useState<IInvitationMetaResponse | null>(null);
    const [metaError, setMetaError] = useState<string | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);

    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<OnboardFormValues>({
        resolver: zodResolver(onboardFormSchema),
        defaultValues: { token },
    });

    useEffect(() => {
        let cancelled = false;

        const loadMeta = async (): Promise<void> => {
            try {
                const data = await fetchInvitationMeta(token);

                if (!cancelled) {
                    setMeta(data);
                }
            } catch {
                if (!cancelled) {
                    setMetaError('This invitation link is invalid or has expired.');
                }
            }
        };

        void loadMeta();

        return () => {
            cancelled = true;
        };
    }, [token]);

    const onSubmit = async (values: OnboardFormValues): Promise<void> => {
        setSubmitError(null);

        try {
            const { accessToken } = await redeemInvitation({
                token: values.token,
                firstName: values.firstName,
                lastName: values.lastName,
                dateOfBirth: values.dateOfBirth,
                password: values.password,
            });

            const payload = decodeJwtPayload(accessToken);

            authStore.setState({
                accessToken,
                userId: payload.sub,
                role: payload.role,
                email: meta?.studentEmail ?? '',
            });

            navigate('/lms');
        } catch (err) {
            if (err instanceof ApiError) {
                if (err.code === INVITATION_EMAIL_CONFLICT_CODE) {
                    setSubmitError('An account with this email already exists.');

                    return;
                }

                if (err.code === 'VALIDATION_FAILED' && err.details) {
                    const fieldErrors = err.details as Record<string, string[]>;

                    for (const [field, messages] of Object.entries(fieldErrors)) {
                        const message = Array.isArray(messages) ? messages[0] : String(messages);

                        setError(field as keyof OnboardFormValues, { message });
                    }

                    return;
                }

                setSubmitError(err.message);

                return;
            }

            setSubmitError('Onboarding failed. Please try again.');
        }
    };

    if (metaError) {
        return (
            <div className="page">
                <p role="alert" className="error">{metaError}</p>
            </div>
        );
    }

    if (!meta) {
        return (
            <div className="page">
                <p>Loading…</p>
            </div>
        );
    }

    if (meta.status === InvitationStatusEnum.REDEEMED) {
        return (
            <div className="page">
                <p role="alert" className="error">This invitation has already been used. If you have an account, please <a href="#/login">log in</a>.</p>
            </div>
        );
    }

    if (meta.status === InvitationStatusEnum.EXPIRED || new Date(meta.expiresAt) <= new Date()) {
        return (
            <div className="page">
                <p role="alert" className="error">This invitation link has expired. Please ask your parent to send a new one.</p>
            </div>
        );
    }

    return (
        <div className="page">
            <h1>Welcome to {meta.courseTitle}</h1>
            <p>You have been invited by <strong>{meta.parentEmail}</strong>.</p>
            <p>Your account will be created for: <strong>{meta.studentEmail}</strong></p>

            <form onSubmit={(event) => void handleSubmit(onSubmit)(event)}>
                <input type="hidden" {...register('token')} />

                <label>
                    First name
                    <input type="text" autoComplete="given-name" {...register('firstName')} />
                </label>
                {errors.firstName ? <p role="alert" className="error">{errors.firstName.message}</p> : null}

                <label>
                    Last name
                    <input type="text" autoComplete="family-name" {...register('lastName')} />
                </label>
                {errors.lastName ? <p role="alert" className="error">{errors.lastName.message}</p> : null}

                <label>
                    Date of birth
                    <input type="date" {...register('dateOfBirth')} />
                </label>
                {errors.dateOfBirth ? <p role="alert" className="error">{errors.dateOfBirth.message}</p> : null}

                <label>
                    Password
                    <input type="password" autoComplete="new-password" {...register('password')} />
                </label>
                {errors.password ? <p role="alert" className="error">{errors.password.message}</p> : null}

                <label>
                    Confirm password
                    <input type="password" autoComplete="new-password" {...register('confirmPassword')} />
                </label>
                {errors.confirmPassword ? <p role="alert" className="error">{errors.confirmPassword.message}</p> : null}

                <button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Creating account…' : 'Create account'}
                </button>
            </form>

            {submitError ? <p role="alert" className="error">{submitError}</p> : null}
        </div>
    );
};
