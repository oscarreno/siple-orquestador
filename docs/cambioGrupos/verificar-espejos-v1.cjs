const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const local = path.resolve(__dirname, '../contratos/grupos-v1');
const manifestBytes = fs.readFileSync(path.join(local, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
for (const base of [local, path.resolve(__dirname, '../../../siple-backTS/docs/contratos/grupos-v1'),
  path.resolve(__dirname, '../../../siple-front/docs/contratos/grupos-v1')]) {
  assert.ok(manifestBytes.equals(fs.readFileSync(path.join(base, 'manifest.json'))), 'Manifiesto diferente');
  for (const entry of manifest.archivos) {
    const bytes = fs.readFileSync(path.join(base, entry.ruta));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256, `${base}/${entry.ruta}`);
    assert.ok(!/[\uFFFD]|\u00C3|\u00C2|\u00E2\u20AC/.test(bytes.toString('utf8')), 'Revisar UTF-8');
  }
}
console.log(`OK: 3 paquetes idénticos; ${manifest.archivos.length} archivos por paquete y manifiestos SHA-256; UTF-8 correcto.`);
