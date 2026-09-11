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

const generator = new OpenApiGeneratorV3(registry.definitions);
const document = generator.generateDocument({
  openapi: '3.0.3',
  info: {
    title: 'Amazon AI Image Studio API',
    version: '0.2.0',
    description: 'OpenAPI generated from Zod contracts (W1 + W2 upload / Truth Pack).',
  },
  servers: [{ url: 'http://localhost:3000' }],
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, '../../../docs/api/openapi.yaml');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, YAML.stringify(document), 'utf8');
console.log(`Wrote ${outPath}`);
