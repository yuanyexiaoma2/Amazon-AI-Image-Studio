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

const generator = new OpenApiGeneratorV3(registry.definitions);
const document = generator.generateDocument({
  openapi: '3.0.3',
  info: {
    title: 'Amazon AI Image Studio API',
    version: '0.3.0',
    description: 'OpenAPI from Zod contracts (W1 + W2 Truth Pack + W3-A Shot Plan).',
  },
  servers: [{ url: 'http://localhost:3000' }],
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, '../../../docs/api/openapi.yaml');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, YAML.stringify(document), 'utf8');
console.log(`Wrote ${outPath}`);
