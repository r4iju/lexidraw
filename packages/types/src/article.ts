// Shared types for Article embedding and nodes

export type ArticleDistilled = {
  title: string;
  byline?: string | null;
  siteName?: string | null;
  wordCount?: number | null;
  excerpt?: string | null;
  contentHtml: string;
  bestImageUrl?: string | null;
  datePublished?: string | null;
  updatedAt?: string; // ISO string
};

export type ArticleNodeUrlData = {
  mode: "url";
  url: string;
  distilled: ArticleDistilled;
};

export type ArticleNodeEntityData = {
  mode: "entity";
  entityId: string;
  /** Optional snapshot for fast initial paint/fallback */
  snapshot?: Pick<
    ArticleDistilled,
    | "title"
    | "byline"
    | "siteName"
    | "wordCount"
    | "updatedAt"
    | "contentHtml"
    | "bestImageUrl"
  >;
};

export type ArticleNodeData = ArticleNodeUrlData | ArticleNodeEntityData;
