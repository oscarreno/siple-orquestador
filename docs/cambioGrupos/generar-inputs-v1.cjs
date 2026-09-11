// Genera modelos de transporte del SDL local. No instala dependencias.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const req = createRequire(path.resolve(__dirname, '../../../siple-backTS/package.json'));
const { parse, Kind } = req('graphql');
const document = parse(fs.readFileSync(path.join(__dirname, 'contrato-grupos-v1-propuesta.graphql'), 'utf8'));
const scalars = { ID: 'string', String: 'string', Int: 'number', Float: 'number', Boolean: 'boolean' };
function typeName(type) {
  if (type.kind === Kind.NON_NULL_TYPE) return typeName(type.type);
  if (type.kind === Kind.LIST_TYPE) return `ReadonlyArray<${typeName(type.type)}>`;
  return scalars[type.name.value] || type.name.value;
}
const lines = [
  '// Generado desde el SDL v1. No editar manualmente.',
  '// Los campos omitidos se conservan; null se admite solo en datos.plantilla.',
  '// Las combinaciones condicionales de operaciones se validan en Backend.', ''
];
for (const definition of document.definitions) {
  if (definition.kind === Kind.ENUM_TYPE_DEFINITION) {
    lines.push(`export type ${definition.name.value} = ${definition.values.map(v => `'${v.name.value}'`).join(' | ')};`, '');
  }
  if (definition.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION) {
    lines.push(`export interface ${definition.name.value} {`);
    for (const field of definition.fields) {
      const optional = field.type.kind === Kind.NON_NULL_TYPE ? '' : '?';
      const nullable = definition.name.value === 'DatosHorarioGrupoInput' && field.name.value === 'plantilla' ? ' | null' : '';
      lines.push(`  readonly ${field.name.value}${optional}: ${typeName(field.type)}${nullable};`);
    }
    lines.push('}', '');
  }
}
const target = path.join(__dirname, 'front/contrato-v1-inputs.ts');
const output = lines.join('\n');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8') !== output) throw new Error('Modelos de entrada desalineados del SDL');
  console.log('OK: modelos de entrada iguales al SDL');
} else {
  fs.writeFileSync(target, output, 'utf8');
  console.log('Modelos de entrada generados');
}
