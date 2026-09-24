import { createApp } from './app.js';
import { migrate } from './migrate.js';

const port = Number(process.env.PORT || 3333);

try {
  await migrate();
} catch (e) {
  console.error('[boot] falha ao migrar o banco:', e.message);
  process.exit(1);
}

createApp().listen(port, () => console.log(`TORVEN API rodando na porta ${port}`));
