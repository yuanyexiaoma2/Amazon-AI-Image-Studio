/** Domain ID branded types (pure — no DB / framework imports). */
export type UserId = string & { readonly __brand: 'UserId' };
export type WorkspaceId = string & { readonly __brand: 'WorkspaceId' };
export type ProjectId = string & { readonly __brand: 'ProjectId' };

export function asUserId(id: string): UserId {
  return id as UserId;
}
export function asWorkspaceId(id: string): WorkspaceId {
  return id as WorkspaceId;
}
export function asProjectId(id: string): ProjectId {
  return id as ProjectId;
}
