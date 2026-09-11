import type { PrismaClient, User, Workspace, WorkspaceMember } from '@prisma/client';
import { normalizeEmail } from '@studio/domain';
import { newId } from '../ids.js';

export type CreateUserWithWorkspaceInput = {
  email: string;
  passwordHash: string;
  name?: string | null;
  workspaceName?: string;
};

export class UserRepository {
  constructor(private readonly db: PrismaClient) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.db.user.findUnique({ where: { email: normalizeEmail(email) } });
  }

  async findById(id: string): Promise<User | null> {
    return this.db.user.findUnique({ where: { id } });
  }

  /** Register user + default workspace + OWNER membership in one transaction. */
  async createWithDefaultWorkspace(
    input: CreateUserWithWorkspaceInput,
  ): Promise<{ user: User; workspace: Workspace; membership: WorkspaceMember }> {
    const userId = newId();
    const workspaceId = newId();
    const memberId = newId();
    const email = normalizeEmail(input.email);

    return this.db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: userId,
          email,
          passwordHash: input.passwordHash,
          name: input.name ?? null,
          sessionVersion: 0,
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          id: workspaceId,
          name: input.workspaceName ?? `${email.split('@')[0]}'s Workspace`,
          ownerUserId: userId,
        },
      });

      const membership = await tx.workspaceMember.create({
        data: {
          id: memberId,
          workspaceId,
          userId,
          role: 'OWNER',
        },
      });

      return { user, workspace, membership };
    });
  }

  /** Increment sessionVersion to invalidate outstanding JWTs (ADR-0002). */
  async bumpSessionVersion(userId: string): Promise<User> {
    return this.db.user.update({
      where: { id: userId },
      data: { sessionVersion: { increment: 1 } },
    });
  }

  async changePassword(userId: string, passwordHash: string): Promise<User> {
    return this.db.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        sessionVersion: { increment: 1 },
      },
    });
  }

  async disableAccount(userId: string): Promise<User> {
    return this.db.user.update({
      where: { id: userId },
      data: {
        status: 'DISABLED',
        sessionVersion: { increment: 1 },
      },
    });
  }

  async listMemberships(userId: string) {
    return this.db.workspaceMember.findMany({
      where: { userId, deletedAt: null },
      include: { workspace: true },
    });
  }

  async isMemberOfWorkspace(userId: string, workspaceId: string): Promise<boolean> {
    const m = await this.db.workspaceMember.findFirst({
      where: { userId, workspaceId, deletedAt: null },
    });
    return Boolean(m);
  }
}
