import { z } from 'zod';

export const CreateExportRequestSchema = z.object({
  items: z
    .array(
      z.object({
        assetVersionId: z.string().uuid(),
        slot: z.enum(['MAIN', 'FEATURE', 'DETAIL', 'DIMENSION', 'LIFESTYLE', 'PACKAGE']).optional(),
        variantCode: z.string().max(40).optional(),
        qaReportId: z.string().uuid().optional(),
      }),
    )
    .min(1)
    .max(30),
  marketplaceCode: z.enum(['US', 'CA', 'MX', 'UK', 'DE', 'FR', 'IT', 'ES', 'JP', 'AU']).optional(),
});

export type CreateExportRequest = z.infer<typeof CreateExportRequestSchema>;

export const ExportBundleSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  status: z.string(),
  sku: z.string(),
  marketplaceCode: z.string(),
  rulePackKey: z.string(),
  rulePackVersion: z.number().int(),
  manifestSha256: z.string().nullable().optional(),
  zipSha256: z.string().nullable().optional(),
  zipBytes: z.number().int().nullable().optional(),
  createdAt: z.string(),
  items: z.array(
    z.object({
      assetVersionId: z.string().uuid(),
      qaReportId: z.string().uuid(),
      approvalId: z.string().uuid(),
      slot: z.string(),
      variantCode: z.string(),
      path: z.string(),
    }),
  ),
});
