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
import procurementRoutes from './routes/procurement.js';
import financeRoutes from './routes/finance.js';
import relationshipRoutes from './routes/relationship.js';
import exportRoutes from './routes/export.js';
import { platformApi, billing } from './routes/platform.js';
import { platformGate } from './platform.js';
import { edgeProxyIp } from './edgeProxy.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(edgeProxyIp); // IP real quando o site (Cloudflare) encaminha /api
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(compression());

  // CORS (F06): origens exatas por ambiente. O site chama a API pela mesma origem (rewrite da Vercel), então
  // em produção sem lista nenhuma origem externa recebe permissão. localhost só fora de produção.
  const prod = process.env.NODE_ENV === 'production';
  const origins = (process.env.CORS_ORIGIN || (prod ? 'https://torven-ebon.vercel.app' : ''))
    .split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors({
    origin(origin, cb) {
      if (!origin) return cb(null, false);
      const ok = origins.includes(origin) || (!prod && (origins.length === 0 || /^http:\/\/localhost(:\d+)?$/.test(origin)));
      cb(null, ok); // origem desconhecida: sem cabeçalho de permissão (o navegador barra); a rota continua exigindo login
    },
  }));
  // respostas da API não ficam em cache (dados privados, tokens, exportações) — F11
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('Pragma', 'no-cache'); next(); });
  app.use((_req, res, next) => { res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()'); next(); });
  // corpo bruto para conferir a assinatura das chamadas da central da plataforma
  app.use(express.json({ limit: '3mb', verify: (req, _res, buf) => { if (req.originalUrl?.includes('/api/platform/')) req.rawBody = buf; } }));

  app.get('/', (_req, res) => res.json({ name: 'TORVEN API', status: 'ok' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  app.use('/api/auth', authRoutes);
  app.use('/api/public', publicRoutes);
  app.use('/api/platform/v1', platformApi); // central da plataforma (chamadas assinadas)

  const api = express.Router();
  api.use(requireAuth);
  api.use(platformGate); // assinatura, bloqueio e módulos definidos pela central
  api.use(autoAudit);
  api.use('/billing', billing);
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
  api.use('/procurement', procurementRoutes);
  api.use('/finance', financeRoutes);
  api.use('/relationship', relationshipRoutes);
  api.use('/export', exportRoutes);
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
    else if (err.type === 'entity.parse.failed') { status = 400; message = 'Requisição inválida.'; }
    if (status >= 500) console.error(err);
    // erros previstos (HttpError) mostram a mensagem; só falhas inesperadas viram a mensagem genérica
    const expected = err instanceof HttpError;
    res.status(status).json({ error: status >= 500 && !expected ? 'Erro interno no servidor.' : message, ...(err.extra || {}) });
  });

  return app;
}
