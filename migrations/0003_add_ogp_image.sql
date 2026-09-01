-- ページの og:image URL を保存し、一覧画面でサムネイルプレビューを表示できるようにする。
-- 既存の行や seed データはこの列が追加される前に保存されたため、og:image の値を持たない。
-- NOT NULL DEFAULT '' により、これらの行は空文字で埋められる。アプリはこれを「画像なし」
-- として扱う。サムネイルを表示するかどうかの判定は NULL ではなく空文字で行っているため、
-- og:image が無い場合は単にプレビューが表示されないだけで、動作上の問題はない。
ALTER TABLE bookmarks ADD COLUMN ogp_image_url TEXT NOT NULL DEFAULT '';
