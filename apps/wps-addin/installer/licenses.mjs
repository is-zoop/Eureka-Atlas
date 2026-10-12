import { readFileSync, existsSync, readdirSync, writeFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const root = resolve(import.meta.dirname, '..');
const packageFile = join(root, 'package.json');
const visited = new Set(); const notices = [];
function visit(name, from) {
  const require = createRequire(from);
  const folder = require.resolve.paths(name).map(base => join(base, name)).find(base => existsSync(join(base, 'package.json')));
  if (!folder) throw new Error(`Missing dependency license: ${name}`);
  const file = join(realpathSync(folder), 'package.json'); const pkg = JSON.parse(readFileSync(file, 'utf8'));
  const id = `${pkg.name}@${pkg.version}`; if (visited.has(id)) return; visited.add(id);
  if (!pkg.name.startsWith('@eureka-atlas/')) {
    const files = readdirSync(folder).filter(x => /^(license|licence|copying|notice)(\.|$)/i.test(x));
    const supplemental = join(root, 'installer', 'licenses', `${id}.txt`);
    if (!files.length && !existsSync(supplemental)) throw new Error(`Missing license text: ${id}`);
    notices.push(`\n===== ${id} (${pkg.license ?? 'see license'}) =====\n${files.length ? files.map(x => readFileSync(join(folder, x), 'utf8')).join('\n') : readFileSync(supplemental, 'utf8')}`);
  }
  for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, file);
}
// Official browser publishing relay is not part of the desktop build's entry points.
for (const name of Object.keys(JSON.parse(readFileSync(packageFile, 'utf8')).dependencies).filter(x => x !== 'wpsjs-rpc-sdk-new')) visit(name, packageFile);
writeFileSync(process.argv[2], `Third-party web dependency notices\n${notices.join('\n')}`, 'utf8');
console.log(`Collected ${notices.length} dependency licenses.`);
