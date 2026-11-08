PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 180),
  slug TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 1 AND 180),
  excerpt TEXT NOT NULL DEFAULT '' CHECK (length(excerpt) <= 500),
  content TEXT NOT NULL DEFAULT '',
  cover_image_url TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL DEFAULT 'Tactyqal Labs',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS post_categories (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_posts_status_published
  ON posts(status, published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_updated
  ON posts(updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_post_categories_category
  ON post_categories(category_id, post_id);

INSERT OR IGNORE INTO categories (name, slug) VALUES
  ('Startup basics', 'startup-basics'),
  ('Building a team', 'building-a-team'),
  ('Idea validation', 'idea-validation'),
  ('Product building', 'product-building'),
  ('Founder stories', 'founder-stories');
