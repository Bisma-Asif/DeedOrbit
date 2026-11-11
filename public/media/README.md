# Marketing media

The landing page reads only locally served media. The initial fetch script
searches the Pexels Photos and Videos APIs (and Pixabay only when its optional
server secret is set), stores optimized files here, writes
[`media-config.json`](./media-config.json), and refreshes [`CREDITS.md`](./CREDITS.md).

Run `pnpm media:fetch` in a server-side environment where `PEXELS_API_KEY` is
available. The key is read from the process environment and is never sent to the
browser. The platform-admin review route is `#/admin/media-review`; it previews
candidates through the API and saves approved choices to the media config. The
page also opens directly at `/admin/media-review`.

The API deployment uses a persistent disk for `/public/media`. The original
Vercel bundle remains the fallback for media shipped with the frontend. Review
each candidate for people, brands, readable signage, watermarks, and editorial
restrictions before accepting it.
