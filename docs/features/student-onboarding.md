# Feature — Student Onboarding

> Status: stub. Filled in M05 by `mes-scribe`.

## Flow

1. Student opens invitation URL `/onboard/:token`.
2. Frontend calls `GET /invitations/:token/meta` (Public). Returns `{ courseTitle, parentEmail, expiresAt }` or 410 if expired / 409 if already redeemed / 404 if invalid.
3. Form: first name, last name, date of birth, password (Zod-validated, server-validated again).
4. Submit `POST /invitations/redeem` with `{ token, firstName, lastName, dateOfBirth, password }`. Backend (in transaction):
   - Verifies invitation status `ISSUED` and not expired.
   - Creates `users` row with role `STUDENT` (argon2 password hash).
   - Creates `enrolments` row linking student to the course from the originating purchase.
   - Marks invitation `REDEEMED`, sets `redeemed_at`.
   - Returns JWT for the new student.
5. Frontend stores JWT and redirects to `/lms`.

## Edge cases

- Expired token → 410 `INVITATION_EXPIRED`.
- Already redeemed → 409 `INVITATION_ALREADY_REDEEMED`.
- Invalid token → 404 `INVITATION_NOT_FOUND`.
- Password too weak → 400 `VALIDATION_FAILED` with `details.fields`.
