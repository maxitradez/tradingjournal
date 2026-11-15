# Guest migration UI verification checklist

Use this checklist only with clearly labelled disposable test records and a dedicated test account. Do not test with real journal data.

## Before testing

- Use the same browser profile and exact origin for creating guest data and testing migration. A GitHub Pages URL, a downloaded ZIP opened with `file://`, and localhost have separate browser storage.
- Use the `audit-and-improvements` branch build. Do not test against or deploy to `main`.
- Apply `supabase/migrations/006_linked_playbook_migration_guard.sql` after migrations 001–005 before running the updated live harness.
- Sign in with a dedicated Supabase test account whose cloud journal can safely receive test records.
- Keep a note of the test account and the disposable record names so they can be identified and cleaned up later.

## Guest snapshot and preview

- While signed out, create one playbook named `MIGRATION TEST ONLY`.
- Create two clearly labelled test trades, including one linked to that playbook.
- Create one daily journal note with `MIGRATION TEST ONLY` in the plan or review.
- Change one or two harmless settings values and record their original values.
- Sign in to the test account and wait for the cloud journal to finish loading.
- Confirm the guest records remain separate and are not visible as cloud records.
- Check the preview consent box and prepare the preview.
- Confirm the counts and record summaries match the disposable guest snapshot.
- Confirm no records have appeared in the cloud journal yet.
- Refresh the page and confirm the preview is restored.
- In a second tab on the same origin, change a guest record after signing in; return to the first tab and confirm preview/import is blocked until refresh captures the latest browser journal.
- Sign out and back in, then confirm the preview is restored for the same account.
- If available, sign in to a second test account and confirm the first account's preview is not shown.

## Controlled import

- Confirm the second migration authorization checkbox is required.
- Start the migration and confirm no record imports automatically.
- Confirm trade import is blocked until all eligible playbooks are imported or explicitly skipped.
- Import the test playbook.
- Import one trade after choosing a trading account, or explicitly confirming it should remain unassigned.
- Import the linked trade and confirm the playbook relationship is preserved.
- Confirm a trade linked to a conflicting or unresolved playbook is held for review and cannot attach itself to a different cloud playbook.
- Confirm a trade linked to a duplicate playbook is held for review if that cloud playbook changes after the preview.
- Import the daily journal note.
- If testing settings, read the warning carefully, confirm the settings action, and verify only the described settings fields change.
- Explicitly skip the remaining disposable record and confirm it is counted as skipped.
- Pause the migration, refresh, resume it, and verify progress is retained.
- Finish only after all remaining records are imported or skipped.
- Confirm the cloud journal contains the intended imported records and the original guest records still exist after signing out.

## Safety and regression checks

- Try to import a trade without choosing an account or confirming unassigned; the UI should block it.
- Try to import settings without checking its confirmation; the UI should block it.
- Confirm failed or conflicting records are not silently treated as imported.
- Confirm a second account cannot see or operate the first account's migration batch.
- Run the updated live Supabase test harness and confirm all 31 checks pass.
- Test the account panel, journal views, trade/playbook editing, daily notes, settings, sign-out, and guest-local mode on desktop and a physical phone.

## Cleanup

- Delete only the clearly labelled disposable test trades, playbook, daily note, and any test-only settings changes after verification.
- Keep migration batch/item audit rows unless a separate, explicit cleanup procedure is approved.
- Never clear all browser storage or delete unlabelled user records as part of test cleanup.
