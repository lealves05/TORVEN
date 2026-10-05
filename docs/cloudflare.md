# TORVEN na Cloudflare (branch `cloudflare`)

Documento completo da migração (ORBI, TORVEN, RUSTEN e Master): `ORBI/docs/cloudflare.md`.

- Endereço: **https://torven.lorler.com.br** (Worker `torven-web`; enquanto o domínio não estiver ativo, `torven-web.<conta>.workers.dev`).
- O Worker (`cloudflare/worker.js`) serve o site e encaminha `/api/*` para a Edge Function `torven-api-cf` da Supabase
  (projeto `dwfbxrfniarhufltmlhb`), com o pacote da API desta branch embutido (`npm run build:edge`). O banco é o mesmo;
  a função `torven-api` (site anterior, gerada pela `main`) continua como está.
- IP real nos limites de tentativa: `backend/src/edgeProxy.js` + segredo `EDGE_PROXY_KEY` (no Worker e na Supabase).
- Central (Master): passa a ser **https://master.lorler.com.br** na virada (`platform_hub_url`; SQL no documento do ORBI).
- Publicar: `PUBLICAR-CLOUDFLARE.bat` (envia a branch ao GitHub sem alterar a `main`, gera o build e publica).
- Build local: `cd frontend && npm run build:cloudflare && npm run deploy:cloudflare`.
- Novidades desta branch (só no site da Cloudflare): OS por voz, placa por foto com consulta paga configurável
  (Configurações › Integrações) e cobrança na maquininha ao fechar a OS (Mercado Pago Point, Stone, Cielo LIO,
  InfinitePay; PagBank e Getnet preparados). Migração `013_voz_placa_maquininha.sql` (só acrescenta tabelas e colunas).
- Placa na abertura da OS: a busca é automática ao completar a placa; achou um veículo, mostra marca/modelo/ano/cor e o
  proprietário, que entra como cliente da OS. Liga/desliga na própria tela (chave "Pesquisa por placa") ou em Configurações › OS,
  onde também fica a consulta automática ao serviço pago (desligada por padrão, pois consome consulta).
- Veículos no cadastro do cliente: vários por cliente (placa, marca, modelo, ano, cor). Por padrão cada placa só pode estar em
  um cadastro (conferido no servidor, com trava contra cadastros simultâneos); Configurações › OS › "Um único cadastro por veículo"
  desliga a restrição. Sem migração nova (usa as colunas de `equipment`).
- Ditado por voz nos campos de texto (computador e celular): microfone dentro dos campos da OS (relato, acessórios, estado,
  diagnóstico, solução, observações, anotações) e das solicitações. Pontuação falada ("vírgula", "ponto final", "nova linha");
  "ponto" solto só vira "." no fim da fala (por causa de "ponto de solda"). Desligável em Configurações › OS › "Ditado por voz".
