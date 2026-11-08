import { createServer as createHttpServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(ROOT, "public");
const SCHEMA = readFileSync(resolve(ROOT, "schema.sql"), "utf8");
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_PAGE_SIZE = 50;
const STATUSES = new Set(["draft", "published"]);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".webp", "image/webp"]
]);

function jsonResponse(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

function errorResponse(response, status, message) {
  jsonResponse(response, status, { error: message });
}

function parseId(value) {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function makeSlug(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 180)
    .replace(/-$/g, "");
}

function parsePostInput(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Request body must be a JSON object." };
  }

  const allowed = new Set([
    "title",
    "slug",
    "excerpt",
    "content",
    "coverImageUrl",
    "authorName",
    "status",
    "categoryIds"
  ]);
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length) {
    return { error: `Unknown field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.` };
  }

  const post = {};
  const stringFields = [
    ["title", "title", 180],
    ["slug", "slug", 180],
    ["excerpt", "excerpt", 500],
    ["content", "content", 100000],
    ["coverImageUrl", "cover_image_url", 2048],
    ["authorName", "author_name", 120],
    ["status", "status", 12]
  ];

  for (const [inputKey, column, maxLength] of stringFields) {
    if (!(inputKey in body)) continue;
    if (typeof body[inputKey] !== "string") {
      return { error: `${inputKey} must be a string.` };
    }
    const value = body[inputKey].trim();
    if (value.length > maxLength) {
      return { error: `${inputKey} must be ${maxLength} characters or fewer.` };
    }
    post[column] = value;
  }

  if (!partial && !("title" in post)) {
    return { error: "title is required." };
  }
  if ("title" in post && post.title.length === 0) {
    return { error: "title cannot be empty." };
  }
  if ("slug" in post) {
    post.slug = makeSlug(post.slug);
    if (!post.slug || !SLUG_PATTERN.test(post.slug)) {
      return { error: "slug must contain letters or numbers separated by hyphens." };
    }
  } else if ("title" in post && !partial) {
    post.slug = makeSlug(post.title);
    if (!post.slug) return { error: "title must contain at least one letter or number." };
  }

  if ("status" in post && !STATUSES.has(post.status)) {
    return { error: "status must be either draft or published." };
  }
  if ("cover_image_url" in post && post.cover_image_url) {
    let url;
    try {
      url = new URL(post.cover_image_url);
    } catch {
      return { error: "coverImageUrl must be an absolute HTTP or HTTPS URL." };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { error: "coverImageUrl must use HTTP or HTTPS." };
    }
  }
  if ("categoryIds" in body) {
    if (
      !Array.isArray(body.categoryIds) ||
      body.categoryIds.length > 10 ||
      body.categoryIds.some((id) => !Number.isSafeInteger(id) || id < 1) ||
      new Set(body.categoryIds).size !== body.categoryIds.length
    ) {
      return { error: "categoryIds must be an array of up to 10 unique positive integers." };
    }
    post.categoryIds = body.categoryIds;
  }

  return { post };
}

async function readJsonBody(request) {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw Object.assign(new Error("Content-Type must be application/json."), { status: 415 });
  }

  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    throw Object.assign(new Error("Request body must be 1 MB or smaller."), { status: 413 });
  }

  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) {
      throw Object.assign(new Error("Request body must be 1 MB or smaller."), { status: 413 });
    }
    chunks.push(chunk);
  }

  if (length === 0) {
    throw Object.assign(new Error("Request body cannot be empty."), { status: 400 });
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must contain valid JSON."), { status: 400 });
  }
}

function safeTokenEqual(supplied, expected) {
  const actualBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function createQueries(db) {
  const postSelect = `
    SELECT p.id, p.title, p.slug, p.excerpt, p.content, p.cover_image_url,
           p.author_name, p.status, p.created_at, p.updated_at, p.published_at,
           COALESCE(
             (SELECT json_group_array(json_object('id', c.id, 'name', c.name, 'slug', c.slug))
              FROM post_categories pc JOIN categories c ON c.id = pc.category_id
              WHERE pc.post_id = p.id),
             '[]'
           ) AS categories
    FROM posts p`;

  const readPost = (row) => {
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      excerpt: row.excerpt,
      content: row.content,
      coverImageUrl: row.cover_image_url,
      authorName: row.author_name,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      publishedAt: row.published_at,
      categories: JSON.parse(row.categories)
    };
  };

  const getCategories = db.prepare("SELECT id, name, slug FROM categories ORDER BY name");
  const getAdminPost = db.prepare(`${postSelect} WHERE p.id = ?`);
  const getPublicPost = db.prepare(`${postSelect} WHERE p.slug = ? AND p.status = 'published'`);
  const listAdminPosts = db.prepare(`${postSelect} ORDER BY p.updated_at DESC, p.id DESC LIMIT ? OFFSET ?`);

  return {
    categories: () => getCategories.all(),
    adminPost: (id) => readPost(getAdminPost.get(id)),
    publicPost: (slug) => readPost(getPublicPost.get(slug)),
    listAdminPosts: (limit, offset) => listAdminPosts.all(limit, offset).map(readPost),
    listPublicPosts: (limit, offset, search) => {
      const like = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
      const query = db.prepare(`
        ${postSelect}
        WHERE p.status = 'published'
          AND (? = '' OR p.title LIKE ? ESCAPE '\\' OR p.excerpt LIKE ? ESCAPE '\\')
        ORDER BY p.published_at DESC, p.id DESC
        LIMIT ? OFFSET ?`);
      return query.all(search, like, like, limit, offset).map(readPost);
    },
    publicCount: (search) => {
      const like = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
      return db.prepare(`
        SELECT COUNT(*) AS count FROM posts p
        WHERE p.status = 'published'
          AND (? = '' OR p.title LIKE ? ESCAPE '\\' OR p.excerpt LIKE ? ESCAPE '\\')`)
        .get(search, like, like).count;
    },
    adminCount: () => db.prepare("SELECT COUNT(*) AS count FROM posts").get().count,
    insertPost: db.prepare(`
      INSERT INTO posts (title, slug, excerpt, content, cover_image_url, author_name, status, created_at, updated_at, published_at)
      VALUES (@title, @slug, @excerpt, @content, @cover_image_url, @author_name, @status, @created_at, @updated_at, @published_at)`),
    updatePost: db.prepare(`
      UPDATE posts SET title = @title, slug = @slug, excerpt = @excerpt, content = @content,
        cover_image_url = @cover_image_url, author_name = @author_name, status = @status,
        updated_at = @updated_at, published_at = @published_at
      WHERE id = @id`),
    deletePost: db.prepare("DELETE FROM posts WHERE id = ?"),
    clearPostCategories: db.prepare("DELETE FROM post_categories WHERE post_id = ?"),
    addPostCategory: db.prepare("INSERT INTO post_categories (post_id, category_id) VALUES (?, ?)"),
    categoryExists: db.prepare("SELECT 1 FROM categories WHERE id = ?")
  };
}

function setCategories(queries, postId, categoryIds) {
  if (!categoryIds) return;
  for (const categoryId of categoryIds) {
    if (!queries.categoryExists.get(categoryId)) {
      throw Object.assign(new Error(`Category ${categoryId} does not exist.`), { status: 400 });
    }
  }
  queries.clearPostCategories.run(postId);
  for (const categoryId of categoryIds) queries.addPostCategory.run(postId, categoryId);
}

function isUniqueConstraint(error) {
  return error?.code === "ERR_SQLITE_ERROR" && /UNIQUE constraint failed: posts\.slug/i.test(error.message);
}

function runTransaction(db, action) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function parseListOptions(searchParams) {
  const pageValue = searchParams.get("page") ?? "1";
  const limitValue = searchParams.get("limit") ?? "10";
  const page = parseId(pageValue);
  const requestedLimit = parseId(limitValue);
  if (!page || !requestedLimit) {
    return { error: "page and limit must be positive integers." };
  }
  if (page > 1000000) return { error: "page must be 1,000,000 or lower." };
  const search = (searchParams.get("search") ?? "").trim();
  if (search.length > 100) return { error: "search must be 100 characters or fewer." };
  const limit = Math.min(requestedLimit, MAX_PAGE_SIZE);
  return { page, limit, offset: (page - 1) * limit, search };
}

function serveAdmin(request, response, pathname) {
  const requestedPath = pathname === "/" || pathname === "/admin"
    ? "/admin.html"
    : pathname.startsWith("/public/")
      ? pathname.slice("/public".length)
      : pathname;
  const target = resolve(PUBLIC_DIR, `.${requestedPath}`);
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + sep)) {
    errorResponse(response, 404, "Not found.");
    return;
  }
  if (!existsSync(target)) {
    errorResponse(response, 404, "Not found.");
    return;
  }
  const type = MIME_TYPES.get(extname(target).toLowerCase());
  if (!type) {
    errorResponse(response, 404, "Not found.");
    return;
  }
  response.writeHead(200, {
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' https:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer"
  });
  createReadStream(target).pipe(response);
}

export function createApp({ dbPath = resolve(ROOT, "data", "blog.sqlite"), adminToken } = {}) {
  const token = adminToken ?? randomBytes(32).toString("hex");
  if (typeof token !== "string" || token.length < 32) {
    throw new Error("BLOG_ADMIN_TOKEN must be at least 32 characters long.");
  }

  if (dbPath !== ":memory:") mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  const queries = createQueries(db);

  async function handle(request, response) {
    let url;
    try {
      url = new URL(request.url, "http://localhost");
    } catch {
      errorResponse(response, 400, "Invalid request URL.");
      return;
    }

    const { pathname, searchParams } = url;
    if (request.method === "GET" && (pathname === "/" || pathname === "/admin" || pathname.startsWith("/public/"))) {
      serveAdmin(request, response, pathname);
      return;
    }
    if (pathname === "/api/health" && request.method === "GET") {
      jsonResponse(response, 200, { status: "ok" });
      return;
    }
    if (pathname === "/api/categories" && request.method === "GET") {
      jsonResponse(response, 200, { data: queries.categories() });
      return;
    }

    if (pathname === "/api/posts" && request.method === "GET") {
      const options = parseListOptions(searchParams);
      if (options.error) return errorResponse(response, 400, options.error);
      const { page, limit, offset, search } = options;
      const total = queries.publicCount(search);
      jsonResponse(response, 200, {
        data: queries.listPublicPosts(limit, offset, search).map(({ content, ...summary }) => summary),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
      });
      return;
    }

    const publicPostMatch = pathname.match(/^\/api\/posts\/([^/]+)$/);
    if (publicPostMatch && request.method === "GET") {
      let slug;
      try {
        slug = decodeURIComponent(publicPostMatch[1]);
      } catch {
        return errorResponse(response, 400, "Post slug is not valid URL encoding.");
      }
      const post = queries.publicPost(slug);
      if (!post) return errorResponse(response, 404, "Published post not found.");
      jsonResponse(response, 200, { data: post });
      return;
    }

    const adminRoute = pathname === "/api/admin/posts" || pathname.startsWith("/api/admin/posts/");
    if (adminRoute) {
      const authorization = request.headers.authorization ?? "";
      const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
      if (!safeTokenEqual(suppliedToken, token)) {
        return errorResponse(response, 401, "A valid Bearer admin token is required.");
      }

      if (pathname === "/api/admin/posts" && request.method === "GET") {
        const options = parseListOptions(searchParams);
        if (options.error) return errorResponse(response, 400, options.error);
        jsonResponse(response, 200, {
          data: queries.listAdminPosts(options.limit, options.offset),
          pagination: {
            page: options.page,
            limit: options.limit,
            total: queries.adminCount(),
            totalPages: Math.ceil(queries.adminCount() / options.limit)
          }
        });
        return;
      }

      if (pathname === "/api/admin/posts" && request.method === "POST") {
        let body;
        try {
          body = await readJsonBody(request);
        } catch (error) {
          return errorResponse(response, error.status ?? 400, error.message);
        }
        const { post, error } = parsePostInput(body);
        if (error) return errorResponse(response, 400, error);
        const now = new Date().toISOString();
        const row = {
          title: post.title,
          slug: post.slug,
          excerpt: post.excerpt ?? "",
          content: post.content ?? "",
          cover_image_url: post.cover_image_url ?? "",
          author_name: post.author_name ?? "Tactyqal Labs",
          status: post.status ?? "draft",
          created_at: now,
          updated_at: now,
          published_at: post.status === "published" ? now : null
        };
        try {
          const create = () => runTransaction(db, () => {
            const result = queries.insertPost.run(row);
            const id = Number(result.lastInsertRowid);
            setCategories(queries, id, post.categoryIds);
            return id;
          });
          const createdPost = queries.adminPost(create());
          jsonResponse(response, 201, { data: createdPost });
        } catch (error) {
          if (isUniqueConstraint(error)) return errorResponse(response, 409, "That slug is already in use.");
          if (error.status) return errorResponse(response, error.status, error.message);
          throw error;
        }
        return;
      }

      const adminPostMatch = pathname.match(/^\/api\/admin\/posts\/([^/]+)$/);
      if (adminPostMatch) {
        const id = parseId(adminPostMatch[1]);
        if (!id) return errorResponse(response, 400, "Post id must be a positive integer.");
        const existing = queries.adminPost(id);
        if (!existing) return errorResponse(response, 404, "Post not found.");

        if (request.method === "GET") {
          jsonResponse(response, 200, { data: existing });
          return;
        }

        if (request.method === "PATCH") {
          let body;
          try {
            body = await readJsonBody(request);
          } catch (error) {
            return errorResponse(response, error.status ?? 400, error.message);
          }
          const { post, error } = parsePostInput(body, { partial: true });
          if (error) return errorResponse(response, 400, error);
          if (!Object.keys(post).length) return errorResponse(response, 400, "Provide at least one field to update.");

          const next = {
            title: post.title ?? existing.title,
            slug: post.slug ?? ("title" in post ? makeSlug(post.title) : existing.slug),
            excerpt: post.excerpt ?? existing.excerpt,
            content: post.content ?? existing.content,
            cover_image_url: post.cover_image_url ?? existing.coverImageUrl,
            author_name: post.author_name ?? existing.authorName,
            status: post.status ?? existing.status
          };
          if (!next.slug) return errorResponse(response, 400, "title must contain at least one letter or number.");
          const now = new Date().toISOString();
          const publishedAt = next.status === "draft"
            ? null
            : existing.status === "published"
              ? existing.publishedAt
              : now;

          try {
            const update = () => runTransaction(db, () => {
              queries.updatePost.run({
                id,
                ...next,
                updated_at: now,
                published_at: publishedAt
              });
              setCategories(queries, id, post.categoryIds);
            });
            update();
            jsonResponse(response, 200, { data: queries.adminPost(id) });
          } catch (error) {
            if (isUniqueConstraint(error)) return errorResponse(response, 409, "That slug is already in use.");
            if (error.status) return errorResponse(response, error.status, error.message);
            throw error;
          }
          return;
        }

        if (request.method === "DELETE") {
          queries.deletePost.run(id);
          response.writeHead(204, { "Cache-Control": "no-store" });
          response.end();
          return;
        }
        return errorResponse(response, 405, "Method not allowed.");
      }
      return errorResponse(response, 404, "Not found.");
    }

    if (pathname.startsWith("/api/")) {
      return errorResponse(response, 404, "Not found.");
    }
    if (request.method === "GET") return serveAdmin(request, response, pathname);
    errorResponse(response, 404, "Not found.");
  }

  const server = createHttpServer((request, response) => {
    Promise.resolve(handle(request, response)).catch((error) => {
      console.error("Blog API request failed:", error);
      if (!response.headersSent) errorResponse(response, 500, "Internal server error.");
      else response.destroy(error);
    });
  });

  return {
    server,
    db,
    token,
    close() {
      return new Promise((resolveClose, reject) => {
        server.close((error) => {
          if (error) return reject(error);
          db.close();
          resolveClose();
        });
      });
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const token = process.env.BLOG_ADMIN_TOKEN ?? randomBytes(32).toString("hex");
  if (token.length < 32) {
    console.error("BLOG_ADMIN_TOKEN must be at least 32 characters long.");
    process.exitCode = 1;
  } else {
    const port = Number(process.env.PORT ?? 8787);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
      console.error("PORT must be an integer between 1 and 65535.");
      process.exitCode = 1;
    } else {
      const app = createApp({
        adminToken: token,
        dbPath: process.env.BLOG_DB_PATH ?? resolve(ROOT, "data", "blog.sqlite")
      });
      app.server.listen(port, "127.0.0.1", () => {
        console.log(`Tactyqal blog backend running at http://127.0.0.1:${port}`);
        if (process.env.BLOG_ADMIN_TOKEN) {
          console.log("Admin bearer token: using BLOG_ADMIN_TOKEN from the environment.");
        } else {
          console.log(`Admin bearer token: ${token}`);
        }
        if (!process.env.BLOG_ADMIN_TOKEN) {
          console.log("Set BLOG_ADMIN_TOKEN before restarting if you want to keep using the same token.");
        }
      });
    }
  }
}
