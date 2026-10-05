# TORVEN na Cloudflare (branch `cloudflare`)

Documento completo da migração (ORBI, TORVEN, RUSTEN e Master): `ORBI/docs/cloudflare.md`.

- Endereço: **https://torven.lorler.com.br** (Worker `torven-web`; enquanto o domínio não estiver ativo, `torven-web.<conta>.workers.dev`).
- O Worker (`cloudflare/worker.js`) serve o site e encaminha `/api/*` para a Edge Function `torven-api` da Supabase
  (projeto `dwfbxrfniarhufltmlhb`). A API e o banco não mudam.
- IP real nos limites de tentativa: `backend/src/edgeProxy.js` + segredo `EDGE_PROXY_KEY` (no Worker e na Supabase).
- Central (Master): passa a ser **https://master.lorler.com.br** na virada (`platform_hub_url`; SQL no documento do ORBI).
- Publicar: `PUBLICAR-CLOUDFLARE.bat` (envia a branch ao GitHub sem alterar a `main`, gera o build e publica).
- Build local: `cd frontend && npm run build:cloudflare && npm run deploy:cloudflare`.
- O pacote da API continua vindo do GitHub Pages, gerado pela `main`: o repasse do IP real só vale depois que a `main`
  receber `edgeProxy.js` (até lá os limites de tentativa usam o IP de saída da Cloudflare).
