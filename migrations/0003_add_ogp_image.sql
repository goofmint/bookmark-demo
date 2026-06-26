-- Add ogp_image_url column to bookmarks table.
-- Existing rows and seed data have no og:image, so empty string is a safe default.
ALTER TABLE bookmarks ADD COLUMN ogp_image_url TEXT NOT NULL DEFAULT '';
