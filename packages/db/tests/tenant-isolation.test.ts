import { describe, expect, it } from 'vitest';
import { ProjectRepository } from '../src/repositories/projects.js';
import { AssetRepository } from '../src/repositories/assets.js';
import { UploadRepository } from '../src/repositories/uploads.js';
import { TruthPackRepository } from '../src/repositories/truth.js';

describe('tenant-scoped repository API contracts', () => {
  it('ProjectRepository findById requires workspaceId', () => {
    expect(ProjectRepository.prototype.findById.length).toBe(2);
    expect(ProjectRepository.prototype.listByWorkspace.length).toBeGreaterThanOrEqual(1);
  });

  it('AssetRepository findById / listByProject require workspaceId', () => {
    expect(AssetRepository.prototype.findById.length).toBe(2);
    expect(AssetRepository.prototype.listByProject.length).toBe(2);
  });

  it('UploadRepository findSession requires workspaceId', () => {
    expect(UploadRepository.prototype.findSession.length).toBe(2);
  });

  it('TruthPackRepository getDocument requires workspaceId', () => {
    expect(TruthPackRepository.prototype.getDocument.length).toBe(2);
  });
});
