// Validación estática; no conecta bases de datos ni ejecuta resolvers.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const back = path.resolve(__dirname, '../../../siple-backTS');
const backRequire = createRequire(path.join(back, 'package.json'));
const graphql = backRequire('graphql');
const { getVariableValues } = backRequire('graphql/execution/values');
const { mergeTypeDefs } = backRequire('@graphql-tools/merge');
const folder = path.join(back, 'src/graphql/schema');
const sources = fs.readdirSync(folder).filter(f => f.endsWith('.graphql'))
  .map(f => fs.readFileSync(path.join(folder, f), 'utf8'));
const bundle = process.argv[2];
const proposal = fs.readFileSync(bundle ? path.join(bundle, 'grupos-v1.graphql') : path.join(__dirname, 'contrato-grupos-v1-propuesta.graphql'), 'utf8');
const markdown = fs.readFileSync(bundle ? path.join(bundle, 'grupos-v1.md') : path.join(__dirname, 'contrato-grupos-v1-propuesta.md'), 'utf8');
const schema = graphql.buildASTSchema(mergeTypeDefs([...sources, proposal]));
const errors = graphql.validateSchema(schema);
const operations = [...markdown.matchAll(/```graphql\r?\n([\s\S]*?)```/g)]
  .map(m => graphql.parse(m[1]));
for (const operation of operations) errors.push(...graphql.validate(schema, operation));
const fixtures = [...markdown.matchAll(/```json\r?\n([\s\S]*?)```/g)]
  .map(m => JSON.parse(m[1]));
const variables = getVariableValues(schema, operations[0].definitions[0].variableDefinitions, fixtures[0]);
errors.push(...(variables.errors || []));
const requestBase = fixtures[0].request;
const generales = { tipo: 'REGULAR', idioma: 'Español', liberable: false, contenido: '' };
const variablesGenerales = getVariableValues(schema, operations[0].definitions[0].variableDefinitions, {
  request: { ...requestBase, cambios: { generales } }
});
errors.push(...(variablesGenerales.errors || []));
if (variablesGenerales.coerced?.request.cambios.generales.liberable !== false ||
    variablesGenerales.coerced?.request.cambios.generales.contenido !== '') {
  throw new Error('La coerción perdió false o texto vacío');
}
if ('cupos' in variablesGenerales.coerced.request.cambios) {
  throw new Error('La coerción agregó un dominio omitido');
}
const entradaAjena = getVariableValues(schema, operations[0].definitions[0].variableDefinitions, {
  request: { ...requestBase, cambios: { generales: { discapacidad: false } } }
});
if (!entradaAjena.errors?.length) throw new Error('El contrato aceptó PB en generales');
for (const fixture of fixtures.slice(1)) {
  const result = fixture.data.aplicarCambiosGrupo;
  const resultType = schema.getType(result.__typename);
  if (!schema.getType('AplicarCambiosGrupoResultado').getTypes().includes(resultType)) {
    throw new Error('Tipo de resultado ajeno a la unión');
  }
  for (const key of Object.keys(result).filter(k => k !== '__typename')) {
    if (!resultType.getFields()[key]) throw new Error(`Campo de resultado desconocido: ${key}`);
  }
}
if (/[\uFFFD]|Ã|Â|â€/.test(proposal + markdown)) throw new Error('Posible corrupción UTF-8');
if (errors.length) {
  console.error(errors.map(error => error.message));
  process.exit(1);
}
console.log(`OK: SDL integrado, ${operations.length} operación, variables y ${fixtures.length} fixtures JSON; generales conserva false/vacío/omisión y rechaza PB; UTF-8 correcto.`);
