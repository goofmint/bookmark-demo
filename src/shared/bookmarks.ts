export type Bookmark = {
  id: number;
  url: string;
  title: string;
  tags: string;
  memo: string;
  // ローカルに保存した OGP 画像の公開パス。画像が無い場合は空文字。
  ogpImageUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateBookmarkRequest = {
  url: string;
  tags?: string;
  memo?: string;
};

export type UpdateBookmarkRequest = {
  url: string;
  tags?: string;
  memo?: string;
};

export type ApiError = {
  error: string;
};
