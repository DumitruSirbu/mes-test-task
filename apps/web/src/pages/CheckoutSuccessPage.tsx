import { useState, type ReactElement } from 'react';
import type { IPurchaseResponse } from '@mes/shared';

const LAST_PURCHASE_STORAGE_KEY = 'mes.lastPurchase.v1';

const readPurchaseFromSession = (): IPurchaseResponse | null => {
    const raw = sessionStorage.getItem(LAST_PURCHASE_STORAGE_KEY);

    if (!raw) {
        return null;
    }

    try {
        return JSON.parse(raw) as IPurchaseResponse;
    } catch {
        sessionStorage.removeItem(LAST_PURCHASE_STORAGE_KEY);

        return null;
    }
};

/**
 * Renders the invitation URL produced by the most recent purchase. The URL is loaded
 * from `sessionStorage` so a reload still shows the link without re-issuing a purchase.
 *
 * The plaintext token lives ONLY in this storage entry on the client — never in the DB,
 * never logged. Clearing the session clears the link.
 */
export const CheckoutSuccessPage = (): ReactElement => {
    const [purchase] = useState<IPurchaseResponse | null>(readPurchaseFromSession);
    const [copied, setCopied] = useState(false);

    if (!purchase) {
        return (
            <div className="page">
                <h1>No recent purchase found</h1>
                <p>Open the catalog and complete checkout to see your invitation link here.</p>
                <a href="#/courses">Go to courses</a>
            </div>
        );
    }

    const onCopy = async (): Promise<void> => {
        try {
            await navigator.clipboard.writeText(purchase.invitation.url);
            setCopied(true);
        } catch {
            setCopied(false);
        }
    };

    return (
        <div className="page">
            <h1>Purchase complete</h1>
            <p>
                Share this invitation link with the student. The link expires on{' '}
                {new Date(purchase.invitation.expiresAt).toLocaleString()}.
            </p>
            <div className="invitation-url">
                <input type="text" readOnly value={purchase.invitation.url} aria-label="Invitation URL" />
                <button type="button" onClick={() => void onCopy()}>{copied ? 'Copied!' : 'Copy'}</button>
            </div>
            <p>
                Student email: <strong>{purchase.invitation.studentEmail}</strong>
            </p>
            <a href="#/courses">Buy another course</a>
        </div>
    );
};
