import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const files = [], directories = [];
function visit(root, prefix = '') {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || /[$"\r\n]/.test(entry.name)) throw new Error('Unsafe payload path');
    const relative = prefix + entry.name;
    if (entry.isDirectory()) { visit(join(root, entry.name), relative + '\\'); directories.push(relative); }
    else if (entry.isFile()) files.push(relative);
    else throw new Error('Unsupported payload entry');
  }
}
visit(process.argv[2]);
writeFileSync(process.argv[3], files.map(x => `Delete "$INSTDIR\\${x}"`).concat(directories.map(x => `RMDir "$INSTDIR\\${x}"`)).join('\n'), 'utf8');
