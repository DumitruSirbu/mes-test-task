import { INVITATION_EMAIL_ATTEMPTS, INVITATION_EMAIL_BACKOFF_DELAY_MS, INVITATION_EMAIL_BACKOFF_CAP_MS } from '../NotificationsConsts';

/**
 * Regression guard: verifies that the maximum backoff delay produced by the
 * exponential strategy does not exceed the 60 s cap (ADR 0006).
 *
 * Formula: delay_n = BACKOFF_DELAY_MS * 2 ** (n - 1) for attempt n.
 * The last attempt uses n = INVITATION_EMAIL_ATTEMPTS.
 *
 * If INVITATION_EMAIL_ATTEMPTS is ever bumped high enough to exceed the cap,
 * this test will fail CI and require an explicit cap implementation.
 */
describe('NotificationsConsts — backoff cap regression', () => {
    it('maximum backoff delay (delay * 2^(attempts-1)) stays within the 60 s cap', () => {
        const maxDelayMs = INVITATION_EMAIL_BACKOFF_DELAY_MS * Math.pow(2, INVITATION_EMAIL_ATTEMPTS - 1);

        expect(maxDelayMs).toBeLessThanOrEqual(INVITATION_EMAIL_BACKOFF_CAP_MS);
    });
});
