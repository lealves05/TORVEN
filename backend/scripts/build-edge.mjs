// Gera dist-edge/index.js: a API inteira em um arquivo para Supabase Edge Functions (Deno).
// Uso: node scripts/build-edge.mjs   → depois publique a pasta dist-edge como função "torven-api".
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const version = (name) => lock.packages?.[`node_modules/${name}`]?.version || pkg.dependencies[name].replace(/^[^\d]*/, '');
const migDir = path.join(root, 'src/migrations');
const migrations = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()
  .map((name) => ({ name, sql: fs.readFileSync(path.join(migDir, name), 'utf8') }));

const used = new Set();
const npmExternals = {
  name: 'deno-externals',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      const id = args.path;
      if (id.startsWith('node:')) return { path: id, external: true };
      if (builtinModules.includes(id.split('/')[0])) return { path: `node:${id}`, external: true };
      const parts = id.split('/');
      const name = id.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
      const sub = id.slice(name.length);
      const spec = `npm:${name}@${version(name)}${sub}`;
      used.add(spec);
      return { path: spec, external: true };
    });
  },
};

await build({
  entryPoints: [path.join(root, 'src/edge.js')],
  outfile: path.join(root, 'dist-edge/index.js'),
  bundle: true, format: 'esm', platform: 'neutral', target: 'es2022',
  plugins: [npmExternals],
  define: { 'globalThis.__TORVEN_MIGRATIONS__': JSON.stringify(migrations) },
  banner: {
    js: [
      "import nodeProcess from 'node:process';",
      "import { Buffer } from 'node:buffer';",
      '// o Edge Runtime não permite alterar variáveis de ambiente: a API usa uma cópia local',
      'const process = { argv: nodeProcess.argv, env: { ...(globalThis.Deno?.env?.toObject?.() ?? nodeProcess.env) } };',
      'process.env.DATABASE_URL ??= process.env.SUPABASE_DB_URL;',
      "process.env.DB_POOL_MAX ??= '3';",
      "process.env.NODE_ENV ??= 'production';",
    ].join('\n'),
  },
  minify: true, legalComments: 'none',
  logLevel: 'info',
});

// Função "carregadora" publicada no Supabase: declara os pacotes npm e, a cada inicialização,
// baixa o bundle publicado no GitHub Pages e o executa (import de data: URL).
const bundleUrl = process.env.EDGE_BUNDLE_URL || 'https://lealves05.github.io/TORVEN/edge/torven-api.js';
fs.writeFileSync(path.join(root, 'dist-edge/loader.ts'), `// TORVEN API — carregadora (gerada por backend/scripts/build-edge.mjs).
// Publique como Edge Function "torven-api" com verify_jwt = false (a API faz a própria autenticação).
${[...used].sort().map((s) => `import '${s}';`).join('\n')}

const BUNDLE = '${bundleUrl}';
const res = await fetch(\`\${BUNDLE}?t=\${Date.now()}\`);
if (!res.ok) throw new Error(\`Não foi possível baixar a API (\${res.status})\`);
const code = await res.text();
await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(code));
`);
