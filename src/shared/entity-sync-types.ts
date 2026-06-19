export type SyncNotificationType =
  | 'title_mismatch'
  | 'new_file'
  | 'unknown_id'
  | 'link_broken'
  | 'link_dead'
  | 'link_missing';

export interface SyncNotification {
  id: string;
  type: SyncNotificationType;
  filePath: string;
  entityName: string | null;
  detectedAt: string;
  dismissed: boolean;
  detail: TitleMismatchDetail | NewFileDetail | UnknownIdDetail | LinkDriftDetail;
}

export interface TitleMismatchDetail {
  kind: 'title_mismatch';
  dbName: string;
  fileTitle: string;
}

export interface NewFileDetail {
  kind: 'new_file';
  parsedTitle: string | null;
}

export interface UnknownIdDetail {
  kind: 'unknown_id';
  fileId: string;
}

export interface LinkDriftDetail {
  kind: 'link_broken' | 'link_dead' | 'link_missing';
  linkText: string;
  suggestedFix: string | null;
  edgeLabel?: string;
}
