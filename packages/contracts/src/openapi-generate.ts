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
import YAML from 'yaml';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

registry.register('RegisterRequest', RegisterRequestSchema);
registry.register('UserResponse', UserResponseSchema);
registry.register('CreateProjectRequest', CreateProjectRequestSchema);
registry.register('Project', ProjectSchema);
registry.register('ApiError', ApiErrorSchema);

registry.registerPath({
  method: 'post',
  path: '/api/register',
  summary: 'Register a new user (creates default workspace)',
  request: {
    body: {
      content: {
        'application/json': { schema: RegisterRequestSchema },
      },
    },
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
  path: '/api/projects',
  summary: 'Create a project in the current workspace',
  request: {
    body: {
      content: {
        'application/json': { schema: CreateProjectRequestSchema },
      },
    },
  },
  responses: {
    201: {
      description: 'Created',
      content: { 'application/json': { schema: ProjectSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
  },
});

const generator = new OpenApiGeneratorV3(registry.definitions);
const document = generator.generateDocument({
  openapi: '3.0.3',
  info: {
    title: 'Amazon AI Image Studio API',
    version: '0.1.0',
    description: 'MVP OpenAPI skeleton generated from Zod contracts (W1-07).',
  },
  servers: [{ url: 'http://localhost:3000' }],
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, '../../../docs/api/openapi.yaml');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, YAML.stringify(document), 'utf8');
console.log(`Wrote ${outPath}`);
