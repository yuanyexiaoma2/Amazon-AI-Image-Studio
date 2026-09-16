/**
 * PR-6 — idempotent provisioning of the LOCAL_MODE principal: a fixed local
 * user + workspace (OWNER, autoApproveGates) + credit grant + default project.
 * Everything is keyed off stable unique values so concurrent / repeated calls
 * converge to the same rows.
 */
import {
  CreditRepository,
  prisma,
  ProjectRepository,
  UserRepository,
} from '@studio/db';
import {
  LOCAL_PROJECT_NAME,
  LOCAL_PROJECT_SKU,
  LOCAL_USER_EMAIL,
  LOCAL_WORKSPACE_NAME,
} from './local-mode';

// Model types derived from the client instance — apps/web has no direct
// @prisma/client dependency under pnpm.
type User = NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>;
type Workspace = Awaited<ReturnType<typeof prisma.workspace.update>>;
type Project = NonNullable<Awaited<ReturnType<typeof prisma.project.findFirst>>>;

export type LocalPrincipal = {
  user: User;
  workspace: Workspace;
  project: Project;
};

/** Deliberately unverifiable — the local user can never log in via password. */
const LOCAL_PASSWORD_HASH = '!local-mode-no-login';
const LOCAL_GRANT_KEY = 'local-mode-bootstrap-grant';
/** Microunits (1e6 = $1). Effectively unlimited for a local workbench. */
const LOCAL_GRANT_MICRUNITS = 1_000_000_000_000;

async function provision(): Promise<LocalPrincipal> {
  const users = new UserRepository(prisma);

  let user = await users.findByEmail(LOCAL_USER_EMAIL);
  let workspace: Workspace | null = null;

  if (user) {
    const memberships = await users.listMemberships(user.id);
    workspace = memberships[0]?.workspace ?? null;
  }

  if (!user || !workspace) {
    const created = await users.createWithDefaultWorkspace({
      email: LOCAL_USER_EMAIL,
      passwordHash: LOCAL_PASSWORD_HASH,
      name: '本地用户',
      workspaceName: LOCAL_WORKSPACE_NAME,
    });
    user = created.user;
    workspace = created.workspace;
  }

  if (!workspace.autoApproveGates) {
    workspace = await prisma.workspace.update({
      where: { id: workspace.id },
      data: { autoApproveGates: true },
    });
  }

  const credits = new CreditRepository(prisma);
  await credits.grant(workspace.id, LOCAL_GRANT_MICRUNITS, LOCAL_GRANT_KEY, 'LOCAL_MODE bootstrap');

  const projects = new ProjectRepository(prisma);
  const existing = await projects.listByWorkspace(workspace.id);
  const project =
    existing[0] ??
    (await projects.create({
      workspaceId: workspace.id,
      sku: LOCAL_PROJECT_SKU,
      name: LOCAL_PROJECT_NAME,
    }));

  return { user, workspace, project };
}

let inflight: Promise<LocalPrincipal> | null = null;

export function ensureLocalPrincipal(): Promise<LocalPrincipal> {
  if (!inflight) {
    inflight = provision().catch((err) => {
      // Allow retry on transient failures (e.g. DB not ready yet).
      inflight = null;
      throw err;
    });
  }
  return inflight;
}
