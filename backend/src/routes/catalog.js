// Cadastros simples: técnicos, fornecedores, serviços.
import { z } from 'zod';
import { crud } from '../crud.js';

const s = z.string().trim();
const opt = s.nullable().optional();
const money = z.coerce.number().min(0);

export const technicians = crud({
  table: 'technicians',
  write: ['technicians_manage'],
  schema: z.object({
    name: s.min(2, 'informe o nome'), phone: opt, email: opt, specialty: opt,
    color: s.regex(/^#[0-9a-fA-F]{6}$/).optional(),
    commission_rate: z.coerce.number().min(0).max(100).optional(),
    hourly_cost: money.optional(), active: z.boolean().optional(),
  }),
});

export const suppliers = crud({
  table: 'suppliers',
  write: ['suppliers', 'purchases'],
  read: ['suppliers', 'purchases', 'materials_manage'],
  search: ['name', 'document', 'contact'],
  schema: z.object({
    name: s.min(2, 'informe o nome'), document: opt, contact: opt, phone: opt, email: opt, address: opt, notes: opt,
    active: z.boolean().optional(),
  }),
});

export const services = crud({
  table: 'services',
  write: ['services_manage'],
  search: ['name', 'category', 'description'],
  order: 'category nulls last, lower(name)',
  schema: z.object({
    name: s.min(2, 'informe o nome'), category: opt, description: opt, unit: s.min(1).optional(),
    price: money.optional(), cost: money.optional(), est_minutes: z.coerce.number().int().min(0).optional(),
    commission_rate: z.coerce.number().min(0).max(100).nullable().optional(), service_code: opt,
    active: z.boolean().optional(),
  }),
});
