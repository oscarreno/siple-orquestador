const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = 'C:/SIPLE/siple-front';
const originals = JSON.parse(fs.readFileSync(path.join(__dirname, 'originales.json'), 'utf8').replace(/^\uFEFF/, ''));
const added = ['src/app/testing/grupo-guardado.fixture.ts', 'src/app/services/grupos-data.service.spec.ts',
  'src/app/components/editar-grupo/editar-grupo.component.spec.ts'];
const entries = [...originals.map(o => ({ ruta: o.ruta, sha256: o.sha256 })), ...added.map(ruta => ({ ruta }))];
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
for (const entry of entries) {
  const dest = path.join(root, entry.ruta);
  const source = path.join(__dirname, entry.ruta);
  if (fs.existsSync(dest) && hash(dest) !== hash(source) && (!entry.sha256 || hash(dest) !== entry.sha256)) {
    throw new Error('Cambio concurrente, no sobrescribir: ' + entry.ruta);
  }
}
for (const entry of entries) {
  const dest = path.join(root, entry.ruta);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(__dirname, entry.ruta), dest);
}
console.log('Aplicados 4 archivos de implementación y 3 archivos de pruebas; originales verificados.');
