import { getFileCategory, type FileCategory } from './file-type-utils';

export function resolveFileType(filename: string): FileCategory {
  return getFileCategory(filename);
}
