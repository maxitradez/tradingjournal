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

## Legacy guest-data recovery
- [ ] In a browser profile that already contains legacy guest records, sign in.
- [ ] Confirm the legacy records remain untouched in browser storage.
- [ ] Confirm the legacy migration panel appears only when legacy records or a saved migration workflow exist.
- [ ] Confirm the migration preview still works and requires explicit per-record choices.
- [ ] Confirm a normal new account with no legacy guest data does not see an empty migration panel.

## Release boundary
- [ ] Keep `main` and `pre-audit-backup` unchanged until all checks pass.
- [ ] Do not treat this checklist as a security certification; review Supabase RLS and production auth settings separately.
