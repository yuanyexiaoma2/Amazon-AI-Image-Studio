import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { RegisterRequestSchema, UserResponseSchema } from './auth.js';
import { CreateProjectRequestSchema, ProjectSchema } from './projects.js';
import { ApiErrorSchema } from './errors.js';
import {
  PresignUploadRequestSchema,
  PresignUploadResponseSchema,
  CompleteUploadRequestSchema,
  CompleteUploadResponseSchema,
} from './uploads.js';
import { TruthPackResponseSchema, SaveTruthPackRequestSchema } from './truth.js';
import {
  ShotPlanResponseSchema,
  GenerateShotPlanRequestSchema,
  SaveShotPlanRequestSchema,
  ApproveShotPlanRequestSchema,
} from './shot-plan.js';
import {
  CreateWorkflowRequestSchema,
  PatchWorkflowRequestSchema,
  SnapshotWorkflowRequestSchema,
  WorkflowDraftSchema,
  MaterializeShotPlanRequestSchema,
  MaterializeShotPlanResponseSchema,
} from './workflow.js';
import {
  CreateRunRequestSchema,
  CreateRunResponseSchema,
  ModelRegistryResponseSchema,
  GenerationRunSchema,
} from './generation.js';
import YAML from 'yaml';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

registry.register('RegisterRequest', RegisterRequestSchema);
registry.register('UserResponse', UserResponseSchema);
registry.register('CreateProjectRequest', CreateProjectRequestSchema);
registry.register('Project', ProjectSchema);
registry.register('ApiError', ApiErrorSchema);
registry.register('PresignUploadRequest', PresignUploadRequestSchema);
registry.register('PresignUploadResponse', PresignUploadResponseSchema);
registry.register('CompleteUploadRequest', CompleteUploadRequestSchema);
registry.register('CompleteUploadResponse', CompleteUploadResponseSchema);
registry.register('TruthPackResponse', TruthPackResponseSchema);
registry.register('SaveTruthPackRequest', SaveTruthPackRequestSchema);
registry.register('ShotPlanResponse', ShotPlanResponseSchema);
registry.register('GenerateShotPlanRequest', GenerateShotPlanRequestSchema);
registry.register('SaveShotPlanRequest', SaveShotPlanRequestSchema);
registry.register('ApproveShotPlanRequest', ApproveShotPlanRequestSchema);
registry.register('CreateWorkflowRequest', CreateWorkflowRequestSchema);
registry.register('PatchWorkflowRequest', PatchWorkflowRequestSchema);
registry.register('SnapshotWorkflowRequest', SnapshotWorkflowRequestSchema);
registry.register('WorkflowDraft', WorkflowDraftSchema);
registry.register('MaterializeShotPlanRequest', MaterializeShotPlanRequestSchema);
registry.register('MaterializeShotPlanResponse', MaterializeShotPlanResponseSchema);
registry.register('CreateRunRequest', CreateRunRequestSchema);
registry.register('CreateRunResponse', CreateRunResponseSchema);
registry.register('ModelRegistryResponse', ModelRegistryResponseSchema);
registry.register('GenerationRun', GenerationRunSchema);

registry.registerPath({
  method: 'post',
  path: '/api/register',
  summary: 'Register a new user (creates default workspace)',
  request: {
    body: { content: { 'application/json': { schema: RegisterRequestSchema } } },
  },
  responses: {
    201: {
      description: 'Created',
      content: { 'application/json': { schema: UserResponseSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/workspaces/{workspaceId}/uploads/presign',
  summary: 'Create presigned upload session + Asset stub',
  request: {
    body: { content: { 'application/json': { schema: PresignUploadRequestSchema } } },
  },
  responses: {
    201: {
      description: 'Created',
      content: { 'application/json': { schema: PresignUploadResponseSchema } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/workspaces/{workspaceId}/uploads/{uploadId}/complete',
  summary: 'Complete upload, verify checksum, enqueue inspect',
  request: {
    body: { content: { 'application/json': { schema: CompleteUploadRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Inspecting / ready',
      content: { 'application/json': { schema: CompleteUploadResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/workspaces/{workspaceId}/projects/{projectId}/truth-pack',
  summary: 'Get current Product Truth Pack',
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: TruthPackResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/workspaces/{workspaceId}/projects/{projectId}/truth-pack',
  summary: 'Save a new Truth Pack draft revision',
  request: {
    body: { content: { 'application/json': { schema: SaveTruthPackRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Saved',
      content: { 'application/json': { schema: TruthPackResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/workspaces/{workspaceId}/projects/{projectId}/shot-plans/generate',
  summary: 'Generate Shot Plan draft (FakeShotPlanProvider; requires approved Truth revision)',
  request: {
    body: { content: { 'application/json': { schema: GenerateShotPlanRequestSchema } } },
  },
  responses: {
    201: {
      description: 'Created',
      content: { 'application/json': { schema: ShotPlanResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/workspaces/{workspaceId}/projects/{projectId}/shot-plans',
  summary: 'Get current Shot Plan + canvasPayload (W3-08 prep)',
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: ShotPlanResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/workspaces/{workspaceId}/projects/{projectId}/shot-plans',
  summary: 'Human-edit Shot Plan (new revision; default PENDING_REVIEW)',
  request: {
    body: { content: { 'application/json': { schema: SaveShotPlanRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Saved',
      content: { 'application/json': { schema: ShotPlanResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/workspaces/{workspaceId}/projects/{projectId}/shot-plans/approve',
  summary: 'Atomically approve Shot Plan revision (W2 Truth approve structure)',
  request: {
    body: { content: { 'application/json': { schema: ApproveShotPlanRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Approved',
      content: { 'application/json': { schema: ShotPlanResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/workspaces/{workspaceId}/projects/{projectId}/shot-plans/materialize',
  summary: 'Materialize approved Shot Plan canvasPayload → workflow graph (W3-08)',
  request: {
    body: { content: { 'application/json': { schema: MaterializeShotPlanRequestSchema } } },
  },
  responses: {
    201: {
      description: 'Created workflow from plan',
      content: { 'application/json': { schema: MaterializeShotPlanResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/workspaces/{workspaceId}/projects/{projectId}/workflows',
  summary: 'Create empty workflow + draft (W3-B1)',
  request: {
    body: { content: { 'application/json': { schema: CreateWorkflowRequestSchema } } },
  },
  responses: {
    201: {
      description: 'Created',
      content: { 'application/json': { schema: WorkflowDraftSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/workspaces/{workspaceId}/workflows/{workflowId}',
  summary: 'Get workflow draft graph + revisionNumber',
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: WorkflowDraftSchema } },
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/workspaces/{workspaceId}/workflows/{workflowId}',
  summary: 'Autosave draft with ifRevision (409 WORKFLOW_REVISION_CONFLICT)',
  request: {
    body: { content: { 'application/json': { schema: PatchWorkflowRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Saved',
      content: { 'application/json': { schema: WorkflowDraftSchema } },
    },
    409: {
      description: 'Optimistic lock conflict',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/workspaces/{workspaceId}/workflows/{workflowId}/snapshot',
  summary: 'Create immutable workflow revision from draft',
  request: {
    body: { content: { 'application/json': { schema: SnapshotWorkflowRequestSchema } } },
  },
  responses: {
    201: { description: 'Snapshot created' },
  },
});



registry.registerPath({
  method: 'get',
  path: '/api/workspaces/{workspaceId}/model-registry',
  summary: 'List enabled models + credit snapshot',
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: ModelRegistryResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/workspaces/{workspaceId}/workflow-revisions/{revisionId}/runs',
  summary: 'Create generation run (estimate → budget → reserve → outbox)',
  request: {
    body: { content: { 'application/json': { schema: CreateRunRequestSchema } } },
  },
  responses: {
    201: {
      description: 'Created',
      content: { 'application/json': { schema: CreateRunResponseSchema } },
    },
    200: {
      description: 'Idempotent replay',
      content: { 'application/json': { schema: CreateRunResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/workspaces/{workspaceId}/runs/{runId}',
  summary: 'Get generation run',
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: GenerationRunSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/workspaces/{workspaceId}/runs/{runId}/cancel',
  summary: 'Cancel run',
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: GenerationRunSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/workspaces/{workspaceId}/attempts/{attemptId}/retry',
  summary: 'Retry failed attempt (new attempt row)',
  responses: {
    201: { description: 'Created' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/workspaces/{workspaceId}/events',
  summary: 'SSE progress stream (?projectId=)',
  responses: { 200: { description: 'text/event-stream' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/providers/{providerKey}/webhook',
  summary: 'Provider webhook (raw body signature verify)',
  responses: { 200: { description: 'Accepted / duplicate' } },
});

const generator = new OpenApiGeneratorV3(registry.definitions);
const document = generator.generateDocument({
  openapi: '3.0.3',
  info: {
    title: 'Amazon AI Image Studio API',
    version: '0.3.2',
    description: 'OpenAPI from Zod contracts (W1 + W2 + W3-A/B Shot Plan, canvas, materialize).',
  },
  servers: [{ url: 'http://localhost:3000' }],
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, '../../../docs/api/openapi.yaml');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, YAML.stringify(document), 'utf8');
console.log(`Wrote ${outPath}`);
