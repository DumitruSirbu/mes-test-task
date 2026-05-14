import { XHR_REQUESTED_WITH, XHR_REQUESTED_WITH_HEADER } from '@mes/shared';
import { LOGOUT_TIMEOUT_MS } from '../const/WebUiConsts';
import { getBaseUrl } from '../api/apiClient';

const postLogout = async (): Promise<void> => {
    const baseUrl = getBaseUrl();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LOGOUT_TIMEOUT_MS);

    try {
        await fetch(`${baseUrl}/auth/logout`, {
            method: 'POST',
            credentials: 'include',
            signal: controller.signal,
            headers: { [XHR_REQUESTED_WITH_HEADER]: XHR_REQUESTED_WITH },
        });
    } finally {
        clearTimeout(timeoutId);
    }
};

export const postLogoutWithRetry = async (): Promise<void> => {
    try {
        await postLogout();
    } catch {
        // First attempt failed — retry once.
        try {
            await postLogout();
        } catch {
            // Both attempts failed. Continue to clear local store regardless.
        }
    }
};
