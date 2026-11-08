# Tactyqal blog backend

A dependency-free Node.js backend and small editorial UI for managing blog posts. It uses SQLite for durable local storage and exposes a public read API plus token-protected editorial CRUD routes.

## Requirements and run

- Node.js 22.13 or newer (uses the built-in `node:sqlite` module).
- From this directory, run `npm start`.
- Open `http://127.0.0.1:8787/admin`.
- The server prints a random admin bearer token on startup. Paste it into the Blog Studio to manage content. The UI keeps it in the current browser tab's `sessionStorage`.
- The SQLite database is created at `data/blog.sqlite`; that local data directory is ignored by Git.

To keep a token across restarts, set a private `BLOG_ADMIN_TOKEN` with at least 32 characters before starting the server. In PowerShell:

```powershell
$env:BLOG_ADMIN_TOKEN = "replace-with-a-private-random-value-at-least-32-characters"
npm start
```

For a custom SQLite file location, set `BLOG_DB_PATH` before starting. The default database path is `data/blog.sqlite` beside the server.

By default, the server binds only to `127.0.0.1`. Keep it local for the demo. Production use needs HTTPS, managed secrets, account-based authentication, backups, rate limits, and deployment-specific hardening.

## Database structure

- `posts` stores titles, unique URL slugs, summaries, Markdown/plain-text content, cover URLs, author byline, draft/published state, and timestamps.
- `categories` stores reusable editorial categories.
- `post_categories` links posts to categories with a composite primary key and cascading deletes.
- Indexes support published-post ordering, editorial sorting, and category lookups.

The schema is in `schema.sql` and is applied at startup. New posts start as drafts. Publishing records `published_at`; unpublishing clears it. Editing a published post preserves its original publication time.

## API

JSON errors use `{ "error": "..." }`. Public list responses include pagination and omit full article content. Public detail reads only return published posts.

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/health` | Public | Health check |
| `GET` | `/api/categories` | Public | List categories |
| `GET` | `/api/posts?page=1&limit=10&search=idea` | Public | Paginated published-post summaries |
| `GET` | `/api/posts/:slug` | Public | Read one published post |
| `GET` | `/api/admin/posts?page=1&limit=50` | Admin | List drafts and published posts |
| `GET` | `/api/admin/posts/:id` | Admin | Read any post, including drafts |
| `POST` | `/api/admin/posts` | Admin | Create a draft or published post |
| `PATCH` | `/api/admin/posts/:id` | Admin | Update post fields or categories |
| `DELETE` | `/api/admin/posts/:id` | Admin | Delete a post |

Admin calls require `Authorization: Bearer <BLOG_ADMIN_TOKEN>` and JSON writes require `Content-Type: application/json`. `POST` and `PATCH` accept `title`, `slug`, `excerpt`, `content`, `coverImageUrl`, `authorName`, `status`, and `categoryIds`. A slug is generated from the title when omitted on create. `status` is `draft` or `published`; category IDs must exist.

Example:

```powershell
$token = "paste-the-token-printed-by-the-server"
$headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }
$post = @{
  title = "Finding a problem worth solving"
  excerpt = "A practical guide to validating an early idea."
  content = "Start by listening to the people who experience the problem..."
  status = "draft"
  categoryIds = @(1, 3)
} | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/admin/posts" -Method Post -Headers $headers -Body $post
```

## Verify

Run `npm test` for API integration tests covering authorization, validation, draft privacy, publication, pagination/search, category relationships, updates, and deletion.
