# Admin access

Admins can open **Admin** in the sidebar (only visible when `is_admin` is true). The page shows pending withdrawals, recent deposits, and tools to grant or revoke admin on other users.

All admin actions are enforced in the database via `security definer` RPCs — the UI alone cannot bypass checks.

## 1. Run the migration

In the Supabase SQL Editor, run:

`supabase/migrations/20250521200000_admin_access.sql`

## 2. Grant your first admin

Use the SQL Editor (service role) to promote your account. Replace the email with yours:

```sql
update public.profiles
set is_admin = true
where email = 'you@example.com';
```

Or by user ID:

```sql
update public.profiles
set is_admin = true
where id = '00000000-0000-0000-0000-000000000000';
```

Sign out and back in, or hard-refresh the page (Ctrl+Shift+R). The sidebar shows **Admin** when your profile loads with `is_admin = true`.

If you still do not see it:

1. Confirm `20250521200000_admin_access.sql` ran in the SQL Editor.
2. In SQL Editor, verify: `select id, email, is_admin from public.profiles where email = 'you@example.com';` — `is_admin` must be `true`.
3. Open `/admin` directly — if you are an admin you will see the dashboard; if not, you are sent home.

## 3. Grant admin to others

1. Open **Admin** → **User access**
2. Search by username, email, or user ID
3. Click **Make admin** / **Revoke admin**

You cannot change your own admin flag from the app (use SQL if needed).

## Withdrawal workflow

1. User requests a withdrawal on `/withdraw` — balance is deducted immediately; status is `pending`.
2. Send crypto from your treasury wallet to the destination address on the admin card.
3. Paste the on-chain **transaction hash** and click **Mark completed**.
4. If you cannot pay out, use **Fail & refund** — balance is returned and `total_withdrawn` is adjusted.

Users receive notifications when status changes to `completed` or `failed`.

## Security notes

- Users cannot set `is_admin` on their own profile (database trigger).
- Only admins can call admin RPCs (`admin_*` functions).
- To remove all admins, use SQL Editor — keep at least one admin account you control.
