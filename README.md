# LottaCash

Premium online casino and sports betting UI with Supabase authentication.

## Quick start

```bash
npm install
cp .env.example .env
# Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from Supabase dashboard
npm run dev
```

- Home: `/`
- Log in: `/login`
- Sign up: `/signup`

## Deploy

See **[DEPLOY.md](./DEPLOY.md)** for GitHub, Vercel, and Supabase setup.

## Security

See **[SECURITY.md](./SECURITY.md)** before publishing to GitHub (private or public): what must stay in Supabase secrets, never in the repo.

## Stack

- React + Vite + TypeScript
- React Router
- Supabase Auth (email/password)
- Vercel (hosting)
