import type { ProjectId, WorkspaceId } from './ids.js';

export type ProjectStatus = 'ACTIVE' | 'ARCHIVED';

export type Project = {
  id: ProjectId;
  workspaceId: WorkspaceId;
  sku: string;
  asin: string | null;
  marketplace: string;
  category: string | null;
  status: ProjectStatus;
  name: string;
};

export function assertSku(sku: string): void {
  if (!sku || sku.trim().length === 0) {
    throw new Error('SKU is required');
  }
  if (sku.length > 64) {
    throw new Error('SKU must be at most 64 characters');
  }
}
