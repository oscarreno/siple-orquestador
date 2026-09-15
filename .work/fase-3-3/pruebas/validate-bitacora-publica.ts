// Run with node -r ts-node/register/transpile-only pruebas/validate-bitacora-publica.ts
// No startup, credentials or database connections: all persistence is simulated.
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { buildSchema, graphql, GraphQLError } from 'graphql';

const root = path.resolve(__dirname, '..');
const saved = new Map<string, any>();
function stub(relative: string, exports: any) {
  const id = require.resolve(path.join(root, relative));
  saved.set(id, require.cache[id]);
  require.cache[id] = { id, filename: id, loaded: true, exports } as any;
}
let writes: string[] = [];
let reads: string[] = [];
stub('src/system/database', { __esModule: true, ORIGEN: { ORACLE: 'ORACLE', MSSQL: 'MSSQL' },
  default: { getInstancia: () => ({
    querySinResultados: async (sql: string) => { writes.push(sql); return true; },
    queryTabla: async (sql: string) => { reads.push(sql); return []; }
  }) } });
stub('src/system/utils', { __esModule: true, CONSOLA: {}, default: { Mensaje() {} } });
stub('src/clases/Chat', { Chat: {} });
stub('src/clases/Usuarios', { Usuarios: { getInstancia() { throw new Error('Unexpected user lookup'); } } });
stub('src/system/jwt', { __esModule: true, default: { comprobarToken() { throw new Error('Unexpected JWT lookup'); } } });

async function main() {
  const { AppError, manejarErrorGraphQL } = require('../src/system/errorHandling');
  const { Log } = require('../src/clases/Log');
  const query = require('../src/graphql/resolvers/queryMensajes').default.Query;
  const sdl = fs.readFileSync(path.join(root, 'src/graphql/schema/mensajes.schema.graphql'), 'utf8');
  const schema = buildSchema(sdl + '\ntype Usuario { usuario: String }');
  const field = schema.getQueryType()!.getFields().guardarBitacora;
  assert.ok(field.deprecationReason);
  assert.strictEqual(String(field.type), 'Boolean!');
  assert.strictEqual(field.args.length, 8);
  const source = 'query { guardarBitacora(usuario:"tester", origen:"ORACLE", grupo:"TEST", periodo:"O2026", cambio:"cupo", campo:"cupo", valorAnterior:"1", valorNuevo:"2") }';
  const originalGet = Log.getInstancia;
  let logCalls = 0;
  Log.getInstancia = () => { logCalls++; return originalGet.call(Log); };
  const originalConsole = console.error;
  console.error = () => {}; // Expected GraphQL rejections log their stack.
  try {
    for (const usuario of ['enlace', 'administrador', 'tester']) {
      for (const origen of ['ORACLE', 'MSSQL']) {
        const result = await graphql({ schema, source: source.replace('ORACLE', origen),
          rootValue: { guardarBitacora: (args: any, context: any) => query.guardarBitacora(null, args, context) },
          contextValue: { auth: { autenticado: true, usuario, source: 'headers', intentoHeaders: true } } });
        assert.strictEqual(result.data, null);
        assert.strictEqual(result.errors?.length, 1);
        const formatted = manejarErrorGraphQL(result.errors![0]);
        assert.strictEqual(formatted.extensions.code, 'AUDITORIA_PUBLICA_NO_DISPONIBLE');
        assert.ok(formatted.message.includes('bitácora'));
      }
    }
    const unauth = await graphql({ schema, source,
      rootValue: { guardarBitacora: (args: any, context: any) => query.guardarBitacora(null, args, context) }, contextValue: {} });
    assert.strictEqual(manejarErrorGraphQL(unauth.errors![0]).extensions.code, 'UNAUTHENTICATED');
    assert.strictEqual(logCalls, 0);
    assert.strictEqual(writes.length, 0);
    assert.strictEqual(reads.length, 0);

    const args = { usuario: 'tester', grupo: 'TEST', periodo: 'O2026', origen: 'ORACLE' };
    const context = { auth: { autenticado: true, usuario: 'tester', source: 'headers' } };
    await assert.rejects(() => query.bitacoraGrupo(null, args, {}));
    await assert.rejects(() => query.bitacoraGrupo(null, { ...args, usuario: 'otro' }, context));
    assert.strictEqual(reads.length, 0);
    assert.deepStrictEqual(await query.bitacoraGrupo(null, args, context), []);
    assert.strictEqual(reads.length, 1);
    for (const origen of ['ORACLE', 'MSSQL']) {
      assert.strictEqual(await Log.getInstancia().guardarBitacora({ ...args, origen, cambio: 'cupo', campo: 'cupo', valorAnterior: '1', valorNuevo: '2' }), true);
    }
    assert.strictEqual(writes.length, 2);
    assert.ok(writes.every(sql => sql.includes('INSERT INTO BitacoraSIPLE')));
    const wrapped = new GraphQLError('wrapped', undefined, undefined, undefined, undefined, new AppError('Denied', 403, 'FORBIDDEN'));
    assert.strictEqual(manejarErrorGraphQL(wrapped).extensions.code, 'FORBIDDEN');
    const explicit = new GraphQLError('explicit', undefined, undefined, undefined, undefined, new AppError('Denied', 403, 'FORBIDDEN'), { code: 'EXPLICIT' });
    assert.strictEqual(manejarErrorGraphQL(explicit).extensions.code, 'EXPLICIT');
    assert.strictEqual(manejarErrorGraphQL(new GraphQLError('unexpected')).extensions.code, 'INTERNAL_SERVER_ERROR');
    console.log('OK: 6 authenticated rejections, authentication, zero public Log/SQL, protected reading, internal SQL and formatter regression.');
  } finally {
    Log.getInstancia = originalGet;
    console.error = originalConsole;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  for (const [id, entry] of saved) { if (entry) require.cache[id] = entry; else delete require.cache[id]; }
});
