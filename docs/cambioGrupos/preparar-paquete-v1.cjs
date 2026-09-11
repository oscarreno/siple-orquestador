// Solo prepara el paquete dentro del repositorio del orquestador.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const target = path.resolve(__dirname, '../contratos/grupos-v1');
const entries = [
  ['contrato-grupos-v1-propuesta.md', 'grupos-v1.md'],
  ['contrato-grupos-v1-propuesta.graphql', 'grupos-v1.graphql'],
  ['matriz-reglas-permisos-v1.md', 'matriz-reglas-permisos-v1.md'],
  ['resolucion-fronteras-v1.md', 'resolucion-fronteras-v1.md'],
  ['revision-aprobacion-v1.md', 'revision-aprobacion-v1.md'],
  ['lectura-v1.graphql', 'lectura-v1.graphql'],
  ['front/contrato-v1-inputs.ts', 'front/contrato-v1-inputs.ts'],
  ['front/contrato-v1-consumo.ts', 'front/contrato-v1-consumo.ts']
];
const files = [];
for (const [source, destination] of entries) {
  let contents = fs.readFileSync(path.join(__dirname, source), 'utf8');
  contents = contents.replaceAll('contrato-grupos-v1-propuesta.graphql', 'grupos-v1.graphql')
    .replaceAll('contrato-grupos-v1-propuesta.md', 'grupos-v1.md');
  const output = path.join(target, destination);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, contents, 'utf8');
  files.push({ ruta: destination, sha256: crypto.createHash('sha256').update(contents).digest('hex') });
}
fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify({ contrato: 'grupos-v1', fecha: '2026-09-08',
  alcance: 'Fundaciones con reservas; no habilita escrituras', archivos: files }, null, 2) + '\n');
console.log(`Paquete preparado: ${target} (${files.length} archivos y manifiesto)`);
