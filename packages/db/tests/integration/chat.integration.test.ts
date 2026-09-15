import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  ChatNotFoundError,
  ChatRepository,
  ProjectRepository,
  UserRepository,
  WorkflowRepository,
  newId,
} from '../../src/index.js';

const run = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';

describe.skipIf(!run)('ChatRepository (V2 PR-4)', () => {
  const db = new PrismaClient();
  const users = new UserRepository(db);
  const projects = new ProjectRepository(db);
  const workflows = new WorkflowRepository(db);
  const chat = new ChatRepository(db);

  afterAll(async () => {
    await db.$disconnect();
  });

  async function seed() {
    const suffix = `${Date.now()}-${newId().slice(0, 8)}`;
    const { user, workspace } = await users.createWithDefaultWorkspace({
      email: `chat-${suffix}@example.com`,
      passwordHash: 'hash',
    });
    const project = await projects.create({
      workspaceId: workspace.id,
      sku: `CHAT-${suffix}`,
      name: 'Chat Project',
    });
    const workflow = await workflows.createEmpty({
      workspaceId: workspace.id,
      projectId: project.id,
      name: 'Chat WF',
      createdByUserId: user.id,
    });
    return { user, workspace, project, workflow };
  }

  it('creates a session (with workflow + budget) and lists it; soft-deleted sessions are filtered', async () => {
    const { user, workspace, project, workflow } = await seed();
    const s1 = await chat.createSession({
      workspaceId: workspace.id,
      projectId: project.id,
      workflowId: workflow.id,
      title: '第一场',
      budgetLimit: { currency: 'USD', amount: 5 },
      createdByUserId: user.id,
    });
    expect(s1.spentMicrounits).toBe(0n);
    expect(s1.workflowId).toBe(workflow.id);

    const s2 = await chat.createSession({
      workspaceId: workspace.id,
      projectId: project.id,
      createdByUserId: user.id,
    });
    expect(s2.workflowId).toBeNull();

    const all = await chat.listSessions(workspace.id, project.id);
    expect(all.map((s) => s.id)).toEqual([s2.id, s1.id]); // createdAt desc

    const forWorkflow = await chat.listSessions(workspace.id, project.id, {
      workflowId: workflow.id,
    });
    expect(forWorkflow.map((s) => s.id)).toEqual([s1.id]);

    await db.chatSession.update({ where: { id: s2.id }, data: { deletedAt: new Date() } });
    const afterDelete = await chat.listSessions(workspace.id, project.id);
    expect(afterDelete.map((s) => s.id)).toEqual([s1.id]);
    expect(await chat.getSession(workspace.id, s2.id)).toBeNull();
  });

  it('appends messages in createdAt order; getWithMessages caps at limit', async () => {
    const { user, workspace, project } = await seed();
    const session = await chat.createSession({
      workspaceId: workspace.id,
      projectId: project.id,
      createdByUserId: user.id,
    });

    await chat.appendMessage({
      workspaceId: workspace.id,
      sessionId: session.id,
      role: 'USER',
      content: { text: '搭建一个生图流程' },
      actorUserId: user.id,
    });
    await chat.appendMessage({
      workspaceId: workspace.id,
      sessionId: session.id,
      role: 'ASSISTANT',
      content: {
        text: '已为你搭建基础生图流程。',
        commandsSummary: { count: 3, types: ['addNode', 'addNode', 'connect'] },
      },
      batchId: newId(),
      provider: 'fake-chat-agent',
      latencyMs: 0,
      actorUserId: user.id,
    });

    const full = await chat.getWithMessages(workspace.id, session.id);
    expect(full?.messages.map((m) => m.role)).toEqual(['USER', 'ASSISTANT']);
    expect(full?.messages[1]?.provider).toBe('fake-chat-agent');
    expect((full?.messages[1]?.contentJson as { text: string }).text).toContain('搭建');

    const capped = await chat.getWithMessages(workspace.id, session.id, { limit: 1 });
    expect(capped?.messages).toHaveLength(1);
    expect(capped?.messages[0]?.role).toBe('ASSISTANT'); // newest first, then asc
  });

  it('addSpentMicrounits accumulates serially and getBudgetState reflects limit + spent', async () => {
    const { user, workspace, project } = await seed();
    const session = await chat.createSession({
      workspaceId: workspace.id,
      projectId: project.id,
      budgetLimit: { currency: 'USD', amount: 1 },
      createdByUserId: user.id,
    });

    expect(await chat.addSpentMicrounits(workspace.id, session.id, 400_000)).toBe(400_000);
    expect(await chat.addSpentMicrounits(workspace.id, session.id, 250_000)).toBe(650_000);

    const state = await chat.getBudgetState(workspace.id, session.id);
    expect(state?.spentMicrounits).toBe(650_000);
    expect(state?.budgetLimit).toEqual({ currency: 'USD', amount: 1 });
  });

  it('enforces tenant isolation: cross-workspace access returns null / throws', async () => {
    const a = await seed();
    const b = await seed();
    const session = await chat.createSession({
      workspaceId: a.workspace.id,
      projectId: a.project.id,
      createdByUserId: a.user.id,
    });

    expect(await chat.getSession(b.workspace.id, session.id)).toBeNull();
    expect(await chat.getWithMessages(b.workspace.id, session.id)).toBeNull();
    expect(await chat.getBudgetState(b.workspace.id, session.id)).toBeNull();
    expect(await chat.listSessions(b.workspace.id, a.project.id)).toEqual([]);
    await expect(
      chat.addSpentMicrounits(b.workspace.id, session.id, 1),
    ).rejects.toBeInstanceOf(ChatNotFoundError);
  });

  it('writes audit events for session creation and assistant turns', async () => {
    const { user, workspace, project } = await seed();
    const session = await chat.createSession({
      workspaceId: workspace.id,
      projectId: project.id,
      createdByUserId: user.id,
    });

    const batchId = newId();
    await chat.appendMessage({
      workspaceId: workspace.id,
      sessionId: session.id,
      role: 'ASSISTANT',
      content: { text: 'ok' },
      batchId,
      actorUserId: user.id,
      commandsCount: 3,
    });

    const events = await db.auditEvent.findMany({
      where: { workspaceId: workspace.id, action: { startsWith: 'chat.' } },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.action)).toEqual(['chat.session_created', 'chat.turn_applied']);
    const turnMeta = events[1]?.metadataJson as Record<string, unknown>;
    expect(turnMeta.batchId).toBe(batchId);
    expect(turnMeta.commandsCount).toBe(3);
  });
});
