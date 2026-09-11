import type { PrismaClient, Project, ProjectStatus } from '@prisma/client';
import { newId } from '../ids.js';

export type CreateProjectInput = {
  workspaceId: string;
  sku: string;
  name: string;
  marketplace?: string;
  category?: string | null;
  asin?: string | null;
};

/**
 * Tenant-scoped project repository.
 * Every query MUST include workspaceId (tenant isolation).
 */
export class ProjectRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateProjectInput): Promise<Project> {
    return this.db.project.create({
      data: {
        id: newId(),
        workspaceId: input.workspaceId,
        sku: input.sku.trim(),
        name: input.name.trim(),
        marketplace: input.marketplace ?? 'US',
        category: input.category ?? null,
        asin: input.asin ?? null,
      },
    });
  }

  async findById(workspaceId: string, projectId: string): Promise<Project | null> {
    return this.db.project.findFirst({
      where: {
        id: projectId,
        workspaceId,
        deletedAt: null,
      },
    });
  }

  async listByWorkspace(
    workspaceId: string,
    status: ProjectStatus = 'ACTIVE',
  ): Promise<Project[]> {
    return this.db.project.findMany({
      where: { workspaceId, status, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }
}
