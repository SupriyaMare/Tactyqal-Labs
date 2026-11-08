import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApp } from "../server.mjs";

const TOKEN = "test-admin-token-that-is-at-least-32-characters";
const app = createApp({ dbPath: ":memory:", adminToken: TOKEN });
let baseUrl;
let postId;

before(async () => {
  await new Promise((resolveListen, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = app.server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await app.close();
});

function adminHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json"
  };
}

async function json(response) {
  return response.json();
}

test("health and categories are available", async () => {
  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await json(health), { status: "ok" });

  const categories = await fetch(`${baseUrl}/api/categories`);
  assert.equal(categories.status, 200);
  assert.ok((await json(categories)).data.some((category) => category.slug === "idea-validation"));

  const editor = await fetch(`${baseUrl}/admin`);
  assert.equal(editor.status, 200);
  assert.match(editor.headers.get("content-type"), /text\/html/);
  const stylesheet = await fetch(`${baseUrl}/public/admin.css`);
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.headers.get("content-type"), /text\/css/);
  assert.match(stylesheet.headers.get("content-security-policy"), /default-src 'self'/);
});

test("editorial routes require a bearer token", async () => {
  const response = await fetch(`${baseUrl}/api/admin/posts`);
  assert.equal(response.status, 401);
  assert.match((await json(response)).error, /Bearer admin token/);
});

test("creates a private draft and validates inputs", async () => {
  const invalid = await fetch(`${baseUrl}/api/admin/posts`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ title: "Unknown field", surprise: true })
  });
  assert.equal(invalid.status, 400);
  assert.match((await json(invalid)).error, /Unknown field/);

  const response = await fetch(`${baseUrl}/api/admin/posts`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      title: "A Better First Product",
      excerpt: "A short summary.",
      content: "The complete article.",
      categoryIds: [1, 3]
    })
  });
  assert.equal(response.status, 201);
  const { data } = await json(response);
  postId = data.id;
  assert.equal(data.slug, "a-better-first-product");
  assert.equal(data.status, "draft");
  assert.equal(data.publishedAt, null);
  assert.deepEqual(data.categories.map((category) => category.id), [1, 3]);

  const invalidCategory = await fetch(`${baseUrl}/api/admin/posts`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ title: "Bad category", categoryIds: [9999] })
  });
  assert.equal(invalidCategory.status, 400);

  const invalidJson = await fetch(`${baseUrl}/api/admin/posts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: "{"
  });
  assert.equal(invalidJson.status, 400);
});

test("drafts stay private and are visible to the editor", async () => {
  const publicList = await fetch(`${baseUrl}/api/posts`);
  assert.equal(publicList.status, 200);
  assert.equal((await json(publicList)).pagination.total, 0);

  const publicDetail = await fetch(`${baseUrl}/api/posts/a-better-first-product`);
  assert.equal(publicDetail.status, 404);

  const adminList = await fetch(`${baseUrl}/api/admin/posts`, { headers: adminHeaders() });
  assert.equal(adminList.status, 200);
  assert.equal((await json(adminList)).data[0].id, postId);

  const adminDetail = await fetch(`${baseUrl}/api/admin/posts/${postId}`, { headers: adminHeaders() });
  assert.equal(adminDetail.status, 200);
  assert.equal((await json(adminDetail)).data.content, "The complete article.");
});

test("publishes, searches, paginates, and returns public post details", async () => {
  const response = await fetch(`${baseUrl}/api/admin/posts/${postId}`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({ status: "published", content: "The public article body." })
  });
  assert.equal(response.status, 200);
  const { data } = await json(response);
  assert.equal(data.status, "published");
  assert.ok(data.publishedAt);

  const duplicate = await fetch(`${baseUrl}/api/admin/posts`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ title: "Duplicate slug", slug: data.slug })
  });
  assert.equal(duplicate.status, 409);

  const search = await fetch(`${baseUrl}/api/posts?search=first&limit=1`);
  const result = await json(search);
  assert.equal(result.pagination.total, 1);
  assert.equal(result.data[0].slug, data.slug);
  assert.equal("content" in result.data[0], false);

  const wildcardSearch = await fetch(`${baseUrl}/api/posts?search=%25`);
  assert.equal((await json(wildcardSearch)).pagination.total, 0);

  const detail = await fetch(`${baseUrl}/api/posts/${data.slug}`);
  assert.equal(detail.status, 200);
  assert.equal((await json(detail)).data.content, "The public article body.");
});

test("category updates are atomic and invalid changes do not alter a post", async () => {
  const response = await fetch(`${baseUrl}/api/admin/posts/${postId}`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({ title: "Changed title", categoryIds: [9999] })
  });
  assert.equal(response.status, 400);

  const readBack = await fetch(`${baseUrl}/api/admin/posts?limit=1`, { headers: adminHeaders() });
  const post = (await json(readBack)).data[0];
  assert.equal(post.title, "A Better First Product");
  assert.deepEqual(post.categories.map((category) => category.id), [1, 3]);
});

test("unpublishing hides a post, and deleting it cleans up categories", async () => {
  const update = await fetch(`${baseUrl}/api/admin/posts/${postId}`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({ status: "draft" })
  });
  assert.equal(update.status, 200);
  assert.equal((await json(update)).data.publishedAt, null);

  const hidden = await fetch(`${baseUrl}/api/posts/a-better-first-product`);
  assert.equal(hidden.status, 404);

  const deletion = await fetch(`${baseUrl}/api/admin/posts/${postId}`, {
    method: "DELETE",
    headers: adminHeaders()
  });
  assert.equal(deletion.status, 204);
  assert.equal(await deletion.text(), "");

  const remaining = await fetch(`${baseUrl}/api/admin/posts`, { headers: adminHeaders() });
  assert.equal((await json(remaining)).pagination.total, 0);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM post_categories").get().count, 0);
});
