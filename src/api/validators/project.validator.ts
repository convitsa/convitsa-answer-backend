import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z
    .string()
    .min(1, 'Project name is required')
    .max(100, 'Project name too long')
    .trim(),
  websiteUrl: z
    .string()
    .url('Invalid website URL')
    .refine(
      (url) => url.startsWith('http://') || url.startsWith('https://'),
      'URL must start with http:// or https://'
    ),
});

// Marketing config schema
const contactOptionsSchema = z.object({
  whatsapp: z.string().optional(),
  instagram: z.string().optional(),
  telegram: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  custom: z.array(z.object({
    label: z.string(),
    url: z.string().url(),
    icon: z.string().optional(),
  })).optional(),
}).optional();

const marketingConfigSchema = z.object({
  aiPersonality: z.enum(['friendly_sales', 'consultative', 'urgency_driven']).optional(),
  calendlyUrl: z.string().url().optional().or(z.literal('')),
  webhookUrl: z.string().url().optional().or(z.literal('')),
  notifyEmail: z.string().email().optional().or(z.literal('')),
  ctaButtons: z.array(z.object({
    label: z.string(),
    url: z.string().url(),
  })).optional(),
  leadCaptureFields: z.array(z.enum(['email', 'phone', 'name', 'company'])).optional(),
  contactOptions: contactOptionsSchema,
  fallbackBehavior: z.enum(['book_meeting', 'show_contacts', 'both']).optional(),
}).optional();

export const updateProjectSchema = z.object({
  name: z
    .string()
    .min(1, 'Project name is required')
    .max(100, 'Project name too long')
    .trim()
    .optional(),
  websiteUrl: z
    .string()
    .url('Invalid website URL')
    .refine(
      (url) => url.startsWith('http://') || url.startsWith('https://'),
      'URL must start with http:// or https://'
    )
    .optional(),
  marketingConfig: marketingConfigSchema,
});

export const createApiKeySchema = z.object({
  name: z
    .string()
    .min(1, 'Key name is required')
    .max(50, 'Key name too long')
    .trim()
    .optional()
    .default('Default Key'),
});

export const paginationSchema = z.object({
  page: z.string().optional().transform((val) => parseInt(val || '1', 10)),
  limit: z.string().optional().transform((val) => Math.min(parseInt(val || '20', 10), 100)),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;


