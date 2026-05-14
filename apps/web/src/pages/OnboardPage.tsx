import { useEffect, useState, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { redeemInvitationSchema, InvitationStatusEnum, ApiErrorCodes } from '@mes/shared';
import type { IInvitationMetaResponse, IAuthTokenResponse } from '@mes/shared';
import { fetchInvitationMeta, redeemInvitation } from '../api/invitationsApi';
import { ApiError } from '../api/apiClient';
import { authStore } from '../auth/authStore';
import { decodeJwtPayload } from '../auth/decodeJwtPayload';
import { navigate } from '../router/router';

interface IProps {
    token: string;
}

const newAccountFormSchema = redeemInvitationSchema
    .extend({
        firstName: z.string().trim().min(1, 'First name is required').max(80),
        lastName: z.string().trim().min(1, 'Last name is required').max(80),
        dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth is required'),
        confirmPassword: z.string().min(1, 'Please confirm your password'),
    })
    .superRefine((data, context) => {
        if (data.password !== data.confirmPassword) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Passwords do not match',
                path: ['confirmPassword'],
            });
        }
    });

const existingAccountFormSchema = z.object({
    token: z.string().min(1),
    password: z.string().min(1, 'Password is required'),
});

type NewAccountFormValues = z.infer<typeof newAccountFormSchema>;
type ExistingAccountFormValues = z.infer<typeof existingAccountFormSchema>;

const onRedeemSuccess = (response: IAuthTokenResponse, studentEmail: string): void => {
    const payload = decodeJwtPayload(response.accessToken);

    authStore.setState({
        accessToken: response.accessToken,
        userId: payload.sub,
        role: payload.role,
        email: studentEmail,
    });

    navigate('/lms');
};

const handleRedeemError = (
    err: unknown,
    setSubmitError: (message: string) => void,
    setFieldError: (field: string, message: string) => void,
): void => {
    if (err instanceof ApiError) {
        if (err.code === ApiErrorCodes.INVITATION_EMAIL_CONFLICT) {
            setSubmitError('This email is registered to a non-student account, or the password you entered is incorrect.');

            return;
        }

        if (err.code === 'VALIDATION_FAILED' && err.details) {
            const fieldErrors = err.details as { fields?: Record<string, string[]> } | Record<string, string[]>;
            const fields = 'fields' in fieldErrors && fieldErrors.fields ? fieldErrors.fields : (fieldErrors as Record<string, string[]>);

            for (const [field, messages] of Object.entries(fields)) {
                const message = Array.isArray(messages) ? messages[0] : String(messages);

                setFieldError(field, message);
            }

            return;
        }

        setSubmitError(err.message);

        return;
    }

    setSubmitError('Onboarding failed. Please try again.');
};

const NewAccountForm = ({ token, studentEmail }: { token: string; studentEmail: string }): ReactElement => {
    const [submitError, setSubmitError] = useState<string | null>(null);

    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<NewAccountFormValues>({
        resolver: zodResolver(newAccountFormSchema),
        defaultValues: { token },
    });

    const onSubmit = async (values: NewAccountFormValues): Promise<void> => {
        setSubmitError(null);

        try {
            const response = await redeemInvitation({
                token: values.token,
                firstName: values.firstName,
                lastName: values.lastName,
                dateOfBirth: values.dateOfBirth,
                password: values.password,
            });

            onRedeemSuccess(response, studentEmail);
        } catch (err) {
            handleRedeemError(
                err,
                (message) => setSubmitError(message),
                (field, message) => setError(field as keyof NewAccountFormValues, { message }),
            );
        }
    };

    return (
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

            {submitError ? <p role="alert" className="error">{submitError}</p> : null}
        </form>
    );
};

const ExistingAccountForm = ({ token, studentEmail }: { token: string; studentEmail: string }): ReactElement => {
    const [submitError, setSubmitError] = useState<string | null>(null);

    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<ExistingAccountFormValues>({
        resolver: zodResolver(existingAccountFormSchema),
        defaultValues: { token },
    });

    const onSubmit = async (values: ExistingAccountFormValues): Promise<void> => {
        setSubmitError(null);

        try {
            const response = await redeemInvitation({
                token: values.token,
                password: values.password,
            });

            onRedeemSuccess(response, studentEmail);
        } catch (err) {
            handleRedeemError(
                err,
                (message) => setSubmitError(message),
                (field, message) => setError(field as keyof ExistingAccountFormValues, { message }),
            );
        }
    };

    return (
        <form onSubmit={(event) => void handleSubmit(onSubmit)(event)}>
            <input type="hidden" {...register('token')} />

            <label>
                Password
                <input type="password" autoComplete="current-password" {...register('password')} />
            </label>
            {errors.password ? <p role="alert" className="error">{errors.password.message}</p> : null}

            <button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Adding course…' : 'Add course to my account'}
            </button>

            {submitError ? <p role="alert" className="error">{submitError}</p> : null}
        </form>
    );
};

export const OnboardPage = ({ token }: IProps): ReactElement => {
    const [meta, setMeta] = useState<IInvitationMetaResponse | null>(null);
    const [metaError, setMetaError] = useState<string | null>(null);

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

    if (meta.hasExistingStudentAccount) {
        return (
            <div className="page">
                <h1>Welcome back</h1>
                <p>You have been invited by <strong>{meta.parentEmail}</strong> to <strong>{meta.courseTitle}</strong>.</p>
                <p>
                    An account already exists for <strong>{meta.studentEmail}</strong>. Enter your password to add this
                    course to your account.
                </p>

                <ExistingAccountForm token={token} studentEmail={meta.studentEmail} />
            </div>
        );
    }

    return (
        <div className="page">
            <h1>Welcome to {meta.courseTitle}</h1>
            <p>You have been invited by <strong>{meta.parentEmail}</strong>.</p>
            <p>Your account will be created for: <strong>{meta.studentEmail}</strong></p>

            <NewAccountForm token={token} studentEmail={meta.studentEmail} />
        </div>
    );
};
