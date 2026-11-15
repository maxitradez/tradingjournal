# Account-first access verification

Run these checks on the `account-first` branch using a fresh ZIP. Do not merge or deploy to `main`.

## Unauthenticated access
- [ ] Open the app in a browser with no Supabase session.
- [ ] Confirm the account-required screen is visible.
- [ ] Confirm Dashboard, Calendar, Trades, Playbooks, Reports, Insights, Settings, and Log Trade are not visible or usable.
- [ ] Confirm no guest journal is displayed.
- [ ] Confirm sign-up and sign-in can be switched from the authentication form.
- [ ] Confirm cancelling or refreshing cannot expose the journal without a session.
- [ ] Temporarily test unavailable Supabase configuration/network: app stays locked and does not fall back to guest mode.

## Account access
- [ ] Create a disposable test account (or use a dedicated test account).
- [ ] If email confirmation is enabled, confirm the app returns to the sign-in form and explains the next step.
- [ ] Sign in and wait for the cloud journal to finish loading.
- [ ] Confirm the journal UI appears only after the cloud load succeeds.
- [ ] Create a disposable trade, playbook, and daily journal entry.
- [ ] Refresh and confirm all three records remain in the account journal.
- [ ] Change a setting, refresh, and confirm it persists to the account.

## Sign-out and account isolation
- [ ] Sign out and confirm the journal UI is hidden immediately.
- [ ] Confirm the previous account's records are not visible after sign-out.
- [ ] Sign in as a second test account and confirm only that account's records appear.
- [ ] Simulate a cloud load failure and confirm the journal remains locked rather than displaying local or stale data.
- [ ] Confirm a cloud save failure is reported and does not show a false success.

## Guest-mode removal
- [ ] Confirm the sign-in screen contains no guest mode or migration panel.
- [ ] Confirm the app does not read, restore, or write a local guest journal.
- [ ] Confirm the legacy `trading-journal-pro-v1` browser storage key is cleared on app startup.
- [ ] Apply `supabase/migrations/007_remove_guest_migration.sql` in the Supabase SQL Editor; verify the two `guest_migration_*` tables and their RPCs are gone. This removes only the retired guest-migration staging/audit data, not account journal records.
- [ ] Sign in normally and confirm no guest migration RPCs or migration prompts are triggered.

## Release boundary
- [ ] Keep `main` and `pre-audit-backup` unchanged until all checks pass.
- [ ] Do not treat this checklist as a security certification; review Supabase RLS and production auth settings separately.
