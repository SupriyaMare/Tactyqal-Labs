# Tactyqal Labs — Full Stack Developer Intern Tasks

This project contains the two practical tasks for the Tactyqal Labs Full Stack Developer Intern hiring challenge:

1. **Task 1 — Homepage redesign:** a responsive, animated homepage redesign for Tactyqal Labs.
2. **Task 2 — Blog backend:** a local-first blog content API, SQLite data model, and browser-based editorial interface.

The homepage and blog backend are separate deliverables. The backend is a working demonstration and is not yet connected to WordPress, the homepage blog cards, or the saved article pages.

## Project structure

```text
www.tactyqal.com/
├── index.html                         # Task 1: redesigned homepage
├── README.md                          # Project overview and run instructions
├── application/
│   └── assets/
│       ├── css/tactyqal-articles.css  # Shared redesign for saved articles
│       ├── images/                    # Logos, favicon, article and homepage images
│       └── img/apps/                  # Student project images
├── blog/                              # Three saved article pages
└── blog-backend/                      # Task 2: Node.js and SQLite blog CMS demo
    ├── public/                         # Editorial UI
    ├── test/                           # API integration tests
    ├── package.json
    ├── schema.sql
    ├── server.mjs
    └── README.md                       # Backend setup, schema, and endpoint reference
```

## Task 1 — Homepage redesign

The homepage is implemented as a self-contained static HTML page in `index.html`, with its styles and small interactions included in the file. It uses the project’s local images and the Tactyqal navy/lime visual theme.

### What is included

- Responsive header, navigation and mobile menu.
- Hero section aimed at parents and teens, with a call to book a free consultation.
- Program highlights, student projects and an eight-week program journey.
- Mentoring and program-benefit sections.
- Student testimonials with working carousel controls.
- Eight startup tools and six article cards.
- Program pricing and included services.
- Parent-focused FAQs, contact details and a contact form.
- Scroll-in animations, reduced-motion support, form validation, and working in-page links.

The homepage contact form validates the visitor’s name and email, then opens a draft addressed to `tactyqal.labs@gmail.com` in the visitor’s email application. It does **not** submit to a server or send an email automatically.

### View the homepage

Open `index.html` directly in a browser, or serve the project folder with any static web server. The homepage does not require a build step or package installation.

## Task 2 — Blog backend

The backend is in `blog-backend/`. It uses Node.js built-in HTTP and SQLite modules, so there are no npm runtime dependencies to install.

### Requirements

- Node.js 22.13 or newer.
- npm, included with Node.js.

### Run the API and editorial UI

In PowerShell:

```powershell
Set-Location 'C:\Users\SUPRIYA\Downloads\www.tactyqal.com\blog-backend'
npm start
```

The server prints its local URL and admin bearer token. Open [http://127.0.0.1:8787/admin](http://127.0.0.1:8787/admin) and paste the token into the Blog Studio to manage content. The UI stores the token in the current browser tab’s `sessionStorage`.

The server binds to `127.0.0.1` by default, so it is only available from the same computer. The SQLite database is created at `blog-backend/data/blog.sqlite`; that runtime data directory is excluded from Git.

To use a stable, private admin token in PowerShell:

```powershell
$env:BLOG_ADMIN_TOKEN = "replace-with-a-private-random-value-at-least-32-characters"
npm start
```

An alternate database location can be set using `BLOG_DB_PATH`. The port can be changed using `PORT`.

### How the blog data is organized

`blog-backend/schema.sql` creates:

- **`posts`** — title, unique slug, excerpt, article content, cover image URL, author, draft/published status, and timestamps.
- **`categories`** — reusable blog categories, seeded with a small starter set.
- **`post_categories`** — a many-to-many link between posts and categories.

Foreign keys, unique slugs, field constraints and indexes help keep records consistent and make published-post and editorial queries efficient. Posts start as drafts. Publishing records the publication time; returning a post to draft clears it. Editing an already-published post preserves its original publication time.

### API overview

| Method | Endpoint | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/health` | Public | Check that the API is available |
| `GET` | `/api/categories` | Public | List categories |
| `GET` | `/api/posts?page=1&limit=10&search=idea` | Public | List and search published post summaries |
| `GET` | `/api/posts/:slug` | Public | Retrieve one published post, including its content |
| `GET` | `/api/admin/posts?page=1&limit=50` | Admin | List drafts and published posts |
| `GET` | `/api/admin/posts/:id` | Admin | Retrieve a post, including a draft |
| `POST` | `/api/admin/posts` | Admin | Create a draft or published post |
| `PATCH` | `/api/admin/posts/:id` | Admin | Update post fields or categories |
| `DELETE` | `/api/admin/posts/:id` | Admin | Delete a post and its category links |

Admin requests require an `Authorization: Bearer <token>` header. Write requests use JSON and support fields such as `title`, `slug`, `excerpt`, `content`, `coverImageUrl`, `authorName`, `status`, and `categoryIds`. If the slug is omitted when creating a post, the API derives it from the title.

The API validates request data, restricts statuses to `draft` and `published`, reports duplicate slugs, paginates results, and keeps drafts out of public listing and detail routes.

### Editorial interface

The Blog Studio at `/admin` supports:

- Connecting with the admin token.
- Listing drafts and published posts.
- Creating and editing posts.
- Automatically generating a URL slug from the title, with an option to edit it.
- Writing an excerpt and article body, setting the author and cover image URL.
- Assigning categories and changing draft/published status.
- Deleting a post after confirmation.

The content editor accepts plain text or Markdown; this demo stores that content but does not include Markdown rendering or a rich-text editor.

## Tests and verification

Run the backend tests from the `blog-backend` directory:

```powershell
npm test
```

The Node test suite covers the health and category routes, admin authorization, validation, draft privacy, publishing, public retrieval, search and pagination, category relationships, updates, and deletion. The API CRUD flows were also exercised through the browser-based editor.

## Scope and production considerations

- The three saved files under `blog/` are existing article snapshots styled for the redesign. They are not dynamically served from this API.
- The backend does not import WordPress content, replace the live WordPress blog, or wire its API into the homepage article cards.
- This is a local assessment/demo architecture, not a production CMS deployment. Before exposing it publicly, add account-based authentication, HTTPS, managed secrets, rate limiting, database backups, deployment monitoring, and a production database strategy.
- Node.js currently marks its built-in SQLite module as experimental. The application has no external package dependencies, but a production deployment should consider a database and driver supported by its hosting environment.
