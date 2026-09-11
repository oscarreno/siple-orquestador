// Ejecuta GraphQL con fixtures locales; nunca usa resolvers ni BD del proyecto.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const back = path.resolve(__dirname, '../../../siple-backTS');
const req = createRequire(path.join(back, 'package.json'));
const g = req('graphql');
const { mergeTypeDefs } = req('@graphql-tools/merge');
const folder = path.join(back, 'src/graphql/schema');
const bundle = process.argv[2];
const contractFolder = bundle || __dirname;
const schema = g.buildASTSchema(mergeTypeDefs([
  ...fs.readdirSync(folder).filter(f => f.endsWith('.graphql')).map(f => fs.readFileSync(path.join(folder, f), 'utf8')),
  fs.readFileSync(path.join(contractFolder, bundle ? 'grupos-v1.graphql' : 'contrato-grupos-v1-propuesta.graphql'), 'utf8')
]));
const md = fs.readFileSync(path.join(contractFolder, bundle ? 'grupos-v1.md' : 'contrato-grupos-v1-propuesta.md'), 'utf8');
const source = [...md.matchAll(/```graphql\r?\n([\s\S]*?)```/g)][0][1];
const fixtures = [...md.matchAll(/```json\r?\n([\s\S]*?)```/g)].map(m => JSON.parse(m[1]));
const ts = req('typescript');
const modelPath = path.join(contractFolder, 'front/contrato-v1-consumo.ts');
const program = ts.createProgram([modelPath], { strict: true, noEmit: true, skipLibCheck: true,
  target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, types: [] });
const diagnostics = ts.getPreEmitDiagnostics(program);
assert.equal(diagnostics.length, 0, diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
const compiled = ts.transpileModule(fs.readFileSync(modelPath, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
}).outputText;
const transport = { exports: {} };
new Function('module', 'exports', compiled)(transport, transport.exports);
async function main() {
  const results = fixtures.slice(1).map(f => f.data.aplicarCambiosGrupo);
  results.push(transport.exports.ejemploAdvertencia);
  const actions = ['ACTUALIZAR', 'MOSTRAR_RECHAZO', 'RESOLVER_CONFLICTO', 'MOSTRAR_RECHAZO'];
  for (let i = 0; i < results.length; i++) {
    const output = await g.graphql({ schema, source, variableValues: fixtures[0],
      rootValue: { aplicarCambiosGrupo: () => results[i] } });
    assert.equal(output.errors, undefined, JSON.stringify(output.errors));
    assert.equal(transport.exports.presentarResultado(output.data.aplicarCambiosGrupo).tipo, actions[i]);
  }
  const coercion = req('graphql/execution/values').getVariableValues;
  const defs = g.parse(source).definitions[0].variableDefinitions;
  const request = fixtures[0].request;
  const missingRole = coercion(schema, defs, { request: { ...request,
    cambios: { materias: [{ operacion: 'BAJA', materia: '123' }] } } });
  assert.ok(missingRole.errors?.length, 'Materia sin rol debe fallar antes del handler');
  const withRole = coercion(schema, defs, { request: { ...request,
    cambios: { materias: [{ operacion: 'BAJA', rol: 'ADICIONAL', materia: '123' }] } } });
  assert.equal(withRole.errors, undefined);
  const confirmar = { ...request, advertenciasConfirmadas: [transport.exports.ejemploAdvertencia.advertencias[0].confirmacion],
    idempotencyKey: 'ejemplo-cupo-confirmado-002' };
  assert.equal(coercion(schema, defs, { request: confirmar }).errors, undefined);
  assert.notEqual(confirmar.idempotencyKey, request.idempotencyKey);
  assert.deepEqual(confirmar.cambios, request.cambios);
  const readSource = fs.readFileSync(path.join(contractFolder, 'lectura-v1.graphql'), 'utf8');
  const estado = { objetivo: request.objetivo, grupo: { llaveUnica: 'grupo-ejemplo', cupoGeneral: 30 },
    revisionGrupoActual: 'rev-17', horariosIdentificados: null,
    capacidades: [{ dominio: 'HORARIOS', operacion: 'BAJA', disponible: false, motivo: 'IDENTIDAD_NO_DISPONIBLE' }] };
  // Fixture parcial para validar transporte, no catálogo exhaustivo de capacidades.
  const read = await g.graphql({ schema, source: readSource, variableValues: { objetivo: request.objetivo },
    rootValue: { grupoParaCambios: () => estado } });
  assert.equal(read.errors, undefined, JSON.stringify(read.errors));
  assert.equal(read.data.grupoParaCambios.horariosIdentificados, null);
  assert.equal(read.data.grupoParaCambios.revisionGrupoActual, 'rev-17');
  const missing = await g.graphql({ schema, source: readSource, variableValues: { objetivo: request.objetivo },
    rootValue: { grupoParaCambios: () => null } });
  assert.equal(missing.errors, undefined);
  assert.equal(missing.data.grupoParaCambios, null);
  console.log('OK: TypeScript estricto; GraphQL mock aplicado/rechazo/conflicto/advertencia; request de confirmación; lectura versionada/null; rol obligatorio. Sin persistencia.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
