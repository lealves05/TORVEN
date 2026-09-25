import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { HttpError } from './util.js';
import { requireAuth } from './auth.js';
import { autoAudit } from './audit.js';

import authRoutes from './routes/auth.js';
import publicRoutes from './routes/public.js';
import companyRoutes from './routes/company.js';
import fiscalSetupRoutes from './routes/fiscalSetup.js';
import userRoutes from './routes/users.js';
import { technicians, suppliers, services } from './routes/catalog.js';
import customerRoutes from './routes/customers.js';
import productRoutes from './routes/products.js';
import purchaseRoutes from './routes/purchases.js';
import quoteRoutes from './routes/quotes.js';
import orderRoutes from './routes/orders.js';
import cashRoutes from './routes/cash.js';
import invoiceRoutes from './routes/invoices.js';
import reportRoutes from './routes/reports.js';
import dashboardRoutes from './routes/dashboard.js';
import unitRoutes from './routes/units.js';
import requestRoutes from './routes/requests.js';
import attachmentRoutes from './routes/attachments.js';
import auditRoutes from './routes/audit.js';
import workspaceRoutes from './routes/workspace.js';
import scheduleRoutes from './routes/schedule.js';
import productionRoutes from './routes/production.js';
import qualityRoutes from './routes/quality.js';
import warrantyRoutes from './routes/warranty.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(compression());

  const origins = (process.env.CORS_ORIGIN || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors({
    origin(origin, cb) {
      if (!origin || origins.length === 0) return cb(null, true);
      const ok = origins.some((o) =>
        o === origin || (o.startsWith('*.') && origin.endsWith(o.slice(1))) ||
        /^http:\/\/localhost(:\d+)?$/.test(origin));
      cb(ok ? null : new HttpError(403, 'Origem não permitida'), ok);
    },
  }));
  app.use(express.json({ limit: '3mb' }));

  app.get('/', (_req, res) => res.json({ name: 'TORVEN API', status: 'ok' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  app.use('/api/auth', authRoutes);
  app.use('/api/public', publicRoutes);

  const api = express.Router();
  api.use(requireAuth);
  api.use(autoAudit);
  api.use('/company/fiscal', fiscalSetupRoutes);
  api.use('/company', companyRoutes);
  api.use('/users', userRoutes);
  api.use('/technicians', technicians);
  api.use('/suppliers', suppliers);
  api.use('/services', services);
  api.use('/customers', customerRoutes);
  api.use('/products', productRoutes);
  api.use('/purchases', purchaseRoutes);
  api.use('/quotes', quoteRoutes);
  api.use('/orders', orderRoutes);
  api.use('/cash', cashRoutes);
  api.use('/invoices', invoiceRoutes);
  api.use('/reports', reportRoutes);
  api.use('/dashboard', dashboardRoutes);
  api.use('/units', unitRoutes);
  api.use('/requests', requestRoutes);
  api.use('/attachments', attachmentRoutes);
  api.use('/audit', auditRoutes);
  api.use('/schedule', scheduleRoutes);
  api.use('/production', productionRoutes);
  api.use('/quality', qualityRoutes);
  api.use('/warranty', warrantyRoutes);
  api.use('/', workspaceRoutes);
  app.use('/api', api);

  app.use((_req, _res, next) => next(new HttpError(404, 'Rota não encontrada')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    let status = err.status || 500;
    let message = err.message || 'Erro interno';
    if (err.code === '23505') { status = 409; message = 'Registro duplicado.'; }
    else if (err.code === '23503') { status = 409; message = 'Registro vinculado a outros dados.'; }
    else if (err.code === '22P02') { status = 400; message = 'Identificador inválido.'; }
    else if (err.type === 'entity.too.large') { status = 413; message = 'Arquivo muito grande.'; }
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Erro interno no servidor.' : message, ...(err.extra || {}) });
  });

  return app;
}
