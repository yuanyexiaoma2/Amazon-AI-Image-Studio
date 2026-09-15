/**
 * Route-level tests for the V2 PR-4 chat agent API:
 * chat-sessions create/list/get + POST messages (agent turn, session budget gate).
 * Runs only with RUN_INTEGRATION=1 (real Postgres), same gate as other route tests.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.fn();

vi.mock('../lib/auth', () => ({
  auth: () => authMock(),
}));

import {
  prisma,
  ChatRepository,
  CreditRepository,
  ProjectRepository,
  UserRepository,
  WorkflowRepository,
  newId,
} from '@studio/db';
import {
  POST as postChatSessions,
  GET as getChatSessions,
} from '../app/api/workspaces/[workspaceId]/projects/[projectId]/chat-sessions/route';
import { GET as getChatSession } from '../app/api/workspaces/[workspaceId]/projects/[projectId]/chat-sessions/[sessionId]/route';
import { POST as postChatMessage } from '../app/api/workspaces/[workspaceId]/projects/[projectId]/chat-sessions/[sessionId]/messages/route';

const run = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';

function ctx(workspaceId: string, projectId: string) {
  return { params: Promise.resolve({ workspaceId, projectId }) };
}

function sessionCtx(workspaceId: string, projectId: string, sessionId: string) {
  return { params: Promise.resolve({ workspaceId, projectId, sessionId }) };
}

function post(url: string, body: unknown) {
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function get(url: string) {
  return new Request(`http://localhost${url}`, { method: 'GET' });
}

function asSession(userId: string, email: string, sessionVersion = 0) {
  authMock.mockResolvedValue({
    user: { id: userId, email },
    sessionVersion,
  });
}

describe.skipIf(!run)('Chat agent API (real route handlers)', () => {
  const users = new UserRepository(prisma);
  const projects = new ProjectRepository(prisma);
  const workflows = new WorkflowRepository(prisma);
  const chat = new ChatRepository(prisma);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(() => {
    authMock.mockReset();
  });

  async function seed() {
    const suffix = `${Date.now()}-${newId().slice(0, 8)}`;
    const owner = await users.createWithDefaultWorkspace({
      email: `chat-owner-${suffix}@example.com`,
      passwordHash: 'hash',
      workspaceName: `CHAT-WS-${suffix}`,
    });
    const project = await projects.create({
      workspaceId: owner.workspace.id,
      sku: `CHATSKU-${suffix}`,
      name: 'Chat Agent',
    });
    const workflow = await workflows.createEmpty({
      workspaceId: owner.workspace.id,
      projectId: project.id,
      name: 'Canvas',
      createdByUserId: owner.user.id,
    });
    // Fund the workspace so run creation passes the credit reservation
    // (mirrors the model-registry route's demo grant).
    const credits = new CreditRepository(prisma);
    await credits.ensureAccount(owner.workspace.id);
    await credits.grant(
      owner.workspace.id,
      10_000_000,
      `seed-grant:${owner.workspace.id}`,
      'test grant $10',
    );
    return { owner, project, workflow };
  }

  it(
    'agent turn: build graph, run with budget accounting, then budget rejects',
    { timeout: 30_000 },
    async () => {
    const { owner, project, workflow } = await seed();
    const workspaceId = owner.workspace.id;
    asSession(owner.user.id, owner.user.email);

    // Create a session bound to the workflow with a $0.01 budget (= 1 fake run).
    const created = await postChatSessions(
      post('/chat-sessions', {
        workflowId: workflow.id,
        title: 'Agent 会话',
        budgetLimit: { currency: 'USD', amount: 0.01 },
      }),
      ctx(workspaceId, project.id),
    );
    expect(created.status).toBe(201);
    const session = await created.json();
    expect(session.workflowId).toBe(workflow.id);
    expect(session.spentMicrounits).toBe(0);

    // Sessions list (filtered by workflowId).
    const listed = await getChatSessions(
      get(`/chat-sessions?workflowId=${workflow.id}`),
      ctx(workspaceId, project.id),
    );
    expect(listed.status).toBe(200);
    const listedJson = await listed.json();
    expect(listedJson.items).toHaveLength(1);
    expect(listedJson.items[0].id).toBe(session.id);

    // Turn 1: fake agent builds the graph (addNode x2 + connect).
    const turn1 = await postChatMessage(
      post('/messages', { content: '帮我搭建一个生图流程' }),
      sessionCtx(workspaceId, project.id, session.id),
    );
    expect(turn1.status).toBe(200);
    const turn1Json = await turn1.json();
    expect(turn1Json.userMessage.role).toBe('USER');
    expect(turn1Json.assistantMessage.role).toBe('ASSISTANT');
    expect(turn1Json.assistantMessage.content.commandsSummary.count).toBe(3);
    expect(turn1Json.assistantMessage.content.commandsSummary.types).toEqual([
      'addNode',
      'addNode',
      'connect',
    ]);
    expect(typeof turn1Json.batchId).toBe('string');
    expect(turn1Json.assistantMessage.batchId).toBe(turn1Json.batchId);
    expect(turn1Json.assistantMessage.provider).toBe('fake-chat-agent');
    expect(turn1Json.run).toBeUndefined();

    // Graph was really mutated: source_image + generate + edge.
    const wfAfterBuild = await workflows.getWithDraft(workspaceId, workflow.id);
    const graph = workflows.parseGraph(wfAfterBuild!.draft!);
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(['chat-gen-1', 'chat-src-1']);
    expect(graph.edges).toHaveLength(1);

    // Turn 2: fake agent runs the graph; run is created and spend accumulates.
    const turn2 = await postChatMessage(
      post('/messages', { content: '运行' }),
      sessionCtx(workspaceId, project.id, session.id),
    );
    expect(turn2.status).toBe(200);
    const turn2Json = await turn2.json();
    expect(turn2Json.run).toBeDefined();
    expect(turn2Json.run.status).toBeDefined();
    expect(turn2Json.run.idempotencyKey).toMatch(/^chat-run-/);
    expect(turn2Json.run.estimateMicrounits).toBe(10_000); // 1 generate node × $0.01
    expect(turn2Json.budgetRejected).toBeUndefined();

    const budgetAfterRun = await chat.getBudgetState(workspaceId, session.id);
    expect(budgetAfterRun?.spentMicrounits).toBe(10_000);

    // Turn 3: budget exhausted — run command rejected, no new run created.
    const turn3 = await postChatMessage(
      post('/messages', { content: '再运行一次' }),
      sessionCtx(workspaceId, project.id, session.id),
    );
    expect(turn3.status).toBe(200);
    const turn3Json = await turn3.json();
    expect(turn3Json.budgetRejected).toBe(true);
    expect(turn3Json.run).toBeUndefined();
    expect(turn3Json.batchId).toBeUndefined();
    expect(turn3Json.assistantMessage.content.budgetRejected).toBe(true);
    expect(turn3Json.assistantMessage.content.text).toContain('预算不足');

    // Session detail carries the full transcript (3 user + 3 assistant messages).
    const detail = await getChatSession(
      get(`/chat-sessions/${session.id}`),
      sessionCtx(workspaceId, project.id, session.id),
    );
    expect(detail.status).toBe(200);
    const detailJson = await detail.json();
    expect(detailJson.id).toBe(session.id);
    expect(detailJson.spentMicrounits).toBe(10_000);
    expect(detailJson.messages).toHaveLength(6);
    expect(detailJson.messages[0].role).toBe('USER');
  });

  it('session without a bound workflow discards canvas commands', async () => {
    const { owner, project } = await seed();
    const workspaceId = owner.workspace.id;
    asSession(owner.user.id, owner.user.email);

    const created = await postChatSessions(
      post('/chat-sessions', { title: '无画布会话' }),
      ctx(workspaceId, project.id),
    );
    expect(created.status).toBe(201);
    const session = await created.json();
    expect(session.workflowId).toBeNull();

    const turn = await postChatMessage(
      post('/messages', { content: '帮我搭建一个生图流程' }),
      sessionCtx(workspaceId, project.id, session.id),
    );
    expect(turn.status).toBe(200);
    const turnJson = await turn.json();
    expect(turnJson.batchId).toBeUndefined();
    expect(turnJson.assistantMessage.content.text).toContain('未绑定画布');
    expect(turnJson.assistantMessage.content.commandsSummary.degraded).toBe(true);
  });

  it('rejects workflowId from another project and enforces tenant isolation', async () => {
    const { owner, project, workflow } = await seed();
    const workspaceId = owner.workspace.id;
    asSession(owner.user.id, owner.user.email);

    // workflowId of a workflow in a DIFFERENT project -> 400.
    const otherProject = await projects.create({
      workspaceId,
      sku: `OTHER-${newId().slice(0, 8)}`,
      name: 'Other',
    });
    const otherWorkflow = await workflows.createEmpty({
      workspaceId,
      projectId: otherProject.id,
      name: 'Other Canvas',
      createdByUserId: owner.user.id,
    });
    const wrongBinding = await postChatSessions(
      post('/chat-sessions', { workflowId: otherWorkflow.id }),
      ctx(workspaceId, project.id),
    );
    expect(wrongBinding.status).toBe(400);

    const created = await postChatSessions(
      post('/chat-sessions', { workflowId: workflow.id }),
      ctx(workspaceId, project.id),
    );
    const session = await created.json();

    // Cross-project access: session exists but not under otherProject -> 404.
    const wrongProject = await getChatSession(
      get(`/chat-sessions/${session.id}`),
      sessionCtx(workspaceId, otherProject.id, session.id),
    );
    expect(wrongProject.status).toBe(404);

    // Cross-tenant: a user with no membership in this workspace -> 403.
    const outsiderSuffix = `${Date.now()}-${newId().slice(0, 8)}`;
    const outsider = await users.createWithDefaultWorkspace({
      email: `chat-outsider-${outsiderSuffix}@example.com`,
      passwordHash: 'hash',
      workspaceName: `CHAT-OUT-${outsiderSuffix}`,
    });
    asSession(outsider.user.id, outsider.user.email);
    const crossTenant = await getChatSession(
      get(`/chat-sessions/${session.id}`),
      sessionCtx(workspaceId, project.id, session.id),
    );
    expect(crossTenant.status).toBe(403);
    const crossTenantPost = await postChatMessage(
      post('/messages', { content: '运行' }),
      sessionCtx(workspaceId, project.id, session.id),
    );
    expect(crossTenantPost.status).toBe(403);
  });
});
