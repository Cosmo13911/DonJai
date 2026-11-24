# DonJai working demo

Approved source: requirement.pdf, Little Moments Figma design, latest envelope/motion/editor feedback. Rename product DonJai. Implement inline in this session.

## Deliverable
A Thai responsive Next.js/TypeScript app: emotionally-led landing, three distinct templates, creator dashboard, four short editor stages with live preview, blocks and photo uploads, autosaved drafts, secure password gate, snapshot publication, cross-device recipient URL, playable matching game and repeat viewing. Demo auth uses browser-owned editing capability; do not imply Supabase accounts exist. Sites is private by default. Next frontend is portable to Vercel; backend adapter has future Supabase schema documentation. No marketplace, payment or lifetime retention claims.

## Files and tasks
1. `lib/gifts.ts`, `lib/crypto.ts`, `tests/domain.test.ts`: validate gift input, preserve published snapshots, secure PBKDF2/AES password envelope and validate six-card matching state. Write failing behavioral tests then implementation.
2. `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `components/*`: responsive UI, three template styles, procedural CSS 3D envelope, timed letter reveal, reduce motion and skip, guided editing with IndexedDB autosave and undo. Routes via query string so static exported Next can serve recipient links.
3. `worker/index.ts`, `scripts/package-worker.mjs`: persistent demo storage behind same-origin API; creator capability checks, publish/unpublish and snapshot, no plaintext passwords, protected recipient payload. File bytes stored with gift within bounded size. R2 when available; explicit draft-local fallback with export if storage unavailable. Package static Next build into Worker to avoid dependence on absent plugin build helpers.
4. `supabase/schema.sql`, `README.md`: production migration path and current demo limitations.
5. Run domain/API tests, TypeScript and Next production build. Browser QA only if supported managed CUA exists. Register, push source and deploy private with Sites; verify returned deployment status and URL.

## UX criteria
Hero invites opening a named envelope; sample access doesn't require creating a gift. Template thumbnails have different content/structure. Primary action starts creation. Editor shows one task at a time, live phone preview, save state, reordering arrows/drag, undo, preview and publish. Recipient has hint, incorrect-password response, no timed games, skip and restart. Hover 150–250ms; page 250–450ms; gift reveal 800–1500ms. Respect prefers-reduced-motion and explicit toggle.
