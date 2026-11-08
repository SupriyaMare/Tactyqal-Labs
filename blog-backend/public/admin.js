const tokenInput = document.querySelector("#admin-token");
const connectButton = document.querySelector("#connect");
const postList = document.querySelector("#post-list");
const postCount = document.querySelector("#post-count");
const categoryOptions = document.querySelector("#category-options");
const form = document.querySelector("#post-form");
const formMessage = document.querySelector("#form-message");
const saveButton = document.querySelector("#save-post");
const deleteButton = document.querySelector("#delete-post");
const statusSelect = document.querySelector("#status");
const titleInput = document.querySelector("#title");
const slugInput = document.querySelector("#slug");

let posts = [];
let categories = [];
let activePostId = null;
let slugWasEdited = false;

tokenInput.value = sessionStorage.getItem("tactyqal-blog-admin-token") ?? "";

function showMessage(message, type = "") {
  formMessage.textContent = message;
  formMessage.className = `form-message ${type}`.trim();
}

function getToken() {
  return tokenInput.value.trim();
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (getToken()) headers.set("Authorization", `Bearer ${getToken()}`);
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers });
  if (response.status === 204) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

function makeSlug(value) {
  return value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 180)
    .replace(/-$/g, "");
}

function renderPosts() {
  postList.replaceChildren();
  postCount.textContent = String(posts.length);
  if (!posts.length) {
    const empty = document.createElement("p");
    empty.className = "empty-note";
    empty.textContent = "No posts yet. Start your first story.";
    postList.append(empty);
    return;
  }

  for (const post of posts) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "post-item";
    button.setAttribute("aria-current", post.id === activePostId ? "true" : "false");
    const title = document.createElement("strong");
    title.textContent = post.title;
    const meta = document.createElement("span");
    const dot = document.createElement("i");
    if (post.status === "published") dot.classList.add("published");
    const state = document.createElement("span");
    state.textContent = post.status === "published" ? "PUBLISHED" : "DRAFT";
    const updated = document.createElement("span");
    updated.textContent = new Date(post.updatedAt).toLocaleDateString();
    meta.append(dot, state, updated);
    button.append(title, meta);
    button.addEventListener("click", () => selectPost(post.id));
    postList.append(button);
  }
}

function renderCategories(selectedIds = []) {
  categoryOptions.replaceChildren();
  if (!categories.length) {
    const note = document.createElement("span");
    note.className = "optional";
    note.textContent = "No categories are configured.";
    categoryOptions.append(note);
    return;
  }
  for (const category of categories) {
    const label = document.createElement("label");
    label.className = "category-choice";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "categoryIds";
    input.value = String(category.id);
    input.checked = selectedIds.includes(category.id);
    const name = document.createElement("span");
    name.textContent = category.name;
    label.append(input, name);
    categoryOptions.append(label);
  }
}

function updateStatusBadge(status) {
  const badge = document.querySelector("#editor-status");
  badge.textContent = status.toUpperCase();
  badge.classList.toggle("published", status === "published");
  saveButton.textContent = status === "published" ? "Publish post" : "Save draft";
}

function resetEditor() {
  activePostId = null;
  slugWasEdited = false;
  form.reset();
  document.querySelector("#author").value = "Tactyqal Labs";
  document.querySelector("#editor-kicker").textContent = "NEW STORY";
  document.querySelector("#editor-title").textContent = "Start with a good idea.";
  deleteButton.hidden = true;
  updateStatusBadge("draft");
  renderCategories();
  renderPosts();
  showMessage("");
}

function selectPost(id) {
  const post = posts.find((item) => item.id === id);
  if (!post) return;
  activePostId = post.id;
  slugWasEdited = true;
  titleInput.value = post.title;
  slugInput.value = post.slug;
  document.querySelector("#author").value = post.authorName;
  document.querySelector("#excerpt").value = post.excerpt;
  document.querySelector("#content").value = post.content;
  document.querySelector("#cover").value = post.coverImageUrl;
  statusSelect.value = post.status;
  document.querySelector("#editor-kicker").textContent = "EDIT STORY";
  document.querySelector("#editor-title").textContent = post.title;
  deleteButton.hidden = false;
  updateStatusBadge(post.status);
  renderCategories(post.categories.map((category) => category.id));
  renderPosts();
  showMessage("");
}

async function loadPosts() {
  if (!getToken()) throw new Error("Paste the admin token shown in the server terminal.");
  sessionStorage.setItem("tactyqal-blog-admin-token", getToken());
  const [postResult, categoryResult] = await Promise.all([
    request("/api/admin/posts?limit=50"),
    fetch("/api/categories").then(async (response) => {
      if (!response.ok) throw new Error("Could not load categories.");
      return response.json();
    })
  ]);
  posts = postResult.data;
  categories = categoryResult.data;
  renderPosts();
  renderCategories();
  showMessage("Connected. Drafts and published posts are ready to manage.", "success");
}

function getFormPost() {
  const data = new FormData(form);
  return {
    title: data.get("title"),
    slug: data.get("slug"),
    authorName: data.get("authorName"),
    excerpt: data.get("excerpt"),
    content: data.get("content"),
    coverImageUrl: data.get("coverImageUrl"),
    status: data.get("status"),
    categoryIds: data.getAll("categoryIds").map(Number)
  };
}

connectButton.addEventListener("click", async () => {
  connectButton.disabled = true;
  showMessage("Connecting…");
  try {
    await loadPosts();
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    connectButton.disabled = false;
  }
});

document.querySelector("#new-post").addEventListener("click", resetEditor);

titleInput.addEventListener("input", () => {
  document.querySelector("#editor-title").textContent = titleInput.value || "Start with a good idea.";
  if (!slugWasEdited) slugInput.value = makeSlug(titleInput.value);
});
slugInput.addEventListener("input", () => { slugWasEdited = true; });
statusSelect.addEventListener("change", () => updateStatusBadge(statusSelect.value));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  saveButton.disabled = true;
  showMessage(activePostId ? "Saving changes…" : "Creating post…");
  try {
    const post = getFormPost();
    const result = await request(
      activePostId ? `/api/admin/posts/${activePostId}` : "/api/admin/posts",
      {
        method: activePostId ? "PATCH" : "POST",
        body: JSON.stringify(post)
      }
    );
    await loadPosts();
    selectPost(result.data.id);
    showMessage(post.status === "published" ? "Post published." : "Draft saved.", "success");
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    saveButton.disabled = false;
  }
});

deleteButton.addEventListener("click", async () => {
  if (!activePostId || !window.confirm("Delete this post permanently?")) return;
  deleteButton.disabled = true;
  showMessage("Deleting post…");
  try {
    await request(`/api/admin/posts/${activePostId}`, { method: "DELETE" });
    await loadPosts();
    resetEditor();
    showMessage("Post deleted.", "success");
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    deleteButton.disabled = false;
  }
});

if (getToken()) loadPosts().catch((error) => showMessage(error.message, "error"));
