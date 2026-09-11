import { z } from 'zod';

export const CreateProjectRequestSchema = z.object({
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  marketplace: z.string().min(2).max(8).default('US'),
  category: z.string().max(200).optional(),
  asin: z.string().max(20).optional(),
});

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  marketplace: z.string(),
  category: z.string().nullable(),
  asin: z.string().nullable(),
  status: z.enum(['ACTIVE', 'ARCHIVED']),
  createdAt: z.string().datetime(),
});

export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;
