import type { ReactElement } from 'react';
import { ApiError } from '../api/apiClient';

interface IErrorMessageProps {
    error: unknown;
}

export const ErrorMessage = ({ error }: IErrorMessageProps): ReactElement => {
    const message = error instanceof ApiError ? error.message : 'An unexpected error occurred.';
    const requestId = error instanceof ApiError ? error.requestId : undefined;

    return (
        <div role="alert" className="error-block">
            <p className="error-text">{message}</p>
            {requestId ? <p className="error-request-id">Request ID: {requestId}</p> : null}
        </div>
    );
};
