# StudyBot

Personal study command center for daily tasks, GATE 2027 and UPSC 2027 countdowns, monthly goals and AI task commands.

## Deploy
Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `GROQ_API_KEY`, and optionally `GROQ_MODEL` in Vercel. Run `supabase/schema.sql` in the Supabase SQL Editor first.

StudyBot does not require email or magic-link sign-in. It creates an anonymous Supabase session automatically so the existing row-level security policies can keep each browser's data isolated.

## Notes
Enable **Anonymous Sign-Ins** in Supabase Authentication settings. Without that setting, the app will show a session bootstrap error instead of pretending it can save tasks.