export type QuickReplyRecord = {
  id: string;
  title: string;
  shortcut: string;
  category: string;
  body: string;
  mediaAssetIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type QuickReplySummary = {
  total: number;
  withMedia: number;
  categoriesInUse: number;
};
