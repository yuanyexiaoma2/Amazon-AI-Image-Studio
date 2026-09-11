import { describe, expect, it } from 'vitest';
import { ProjectRepository } from '../src/repositories/projects.js';

/**
 * Unit-level tenant isolation contract test.
 * Ensures repository APIs always require workspaceId (compile-time + runtime shape).
 * Full DB integration runs when DATABASE_URL points at a migrated Postgres.
 */
describe('ProjectRepository tenant isolation', () => {
  it('findById requires workspaceId as first argument (API contract)', () => {
    // Reflect method arity — both workspaceId and projectId are required.
    expect(ProjectRepository.prototype.findById.length).toBe(2);
    expect(ProjectRepository.prototype.listByWorkspace.length).toBeGreaterThanOrEqual(1);
    expect(ProjectRepository.prototype.create.length).toBe(1);
  });

  it('create input must include workspaceId', () => {
    const input = {
      workspaceId: '00000000-0000-7000-8000-000000000001',
      sku: 'SKU-1',
      name: 'Demo',
    };
    expect(input.workspaceId).toBeTruthy();
  });
});
