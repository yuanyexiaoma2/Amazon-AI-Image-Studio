import type { PrismaClient, User, Workspace, WorkspaceMember } from '@prisma/client';
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
    return this.db.user.findUnique({ where: { email: email.toLowerCase() } });
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
    const email = input.email.toLowerCase();

    return this.db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: userId,
          email,
          passwordHash: input.passwordHash,
          name: input.name ?? null,
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
}
