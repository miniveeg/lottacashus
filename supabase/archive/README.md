# Historical / ad-hoc SQL (do not run)

These files are **not** part of the production schema path.

Canonical path: see `../schema.sql`

| File | Why archived |
|------|----------------|
| FINAL_SCHEMA67.sql | Full destructive rebuild; superseded by lottacash-complete-setup.sql + migrations |
| SITEWIDE_FIX.sql | One-off sitewide patches; folded into migrations/012 |
| ADMIN_RPCS.sql | Admin RPC prototypes; canonical RPCs live in complete-setup + migrations |
| FIX_EVERYTHING.sql | Ad-hoc fix bundle; superseded by ordered migrations |
| SCHEMA_HARDENED.sql | Hardening experiment; relevant bits in migrations/001–005 |
| SCHEMA_COMPAT_AND_ADMIN.sql | Compat layer; no longer needed |
| case-battles-v2-setup.sql | V2 bootstrap; already embedded in lottacash-complete-setup.sql |

To recover content: `git log --all --full-history -- supabase/<filename>.sql`

Do **not** apply any file in this directory to a live or staging database.
