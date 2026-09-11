import { Kind, parse, ValueNode } from "graphql";
import { NextFunction, Request, Response } from "express";
import Utils, { CONSOLA } from "./utils";

type ErrorConDatos = Error & {
  statusCode?: number;
  code?: string;
  details?: Record<string, unknown>;
  originalError?: ErrorConDatos;
  extensions?: {
    code?: string;
    exception?: {
      stacktrace?: string[];
    };
  };
};

export class AppError extends Error {
  statusCode: number;
  code?: string;
  expose: boolean;
  details?: Record<string, unknown>;

  constructor(message: string, statusCode = 500, code?: string, expose = true, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.expose = expose;
    this.details = details;
  }
}

function esError(valor: unknown): valor is ErrorConDatos {
  return valor instanceof Error;
}

export function obtenerError(error: unknown): ErrorConDatos {
  if (esError(error)) return error;

  const mensaje =
    typeof error === "string"
      ? error
      : error === null || error === undefined
        ? "Error desconocido"
        : JSON.stringify(error);

  return new Error(mensaje);
}

export function mensajeSeguro(error: unknown, mensajeDefault = "Ocurrio un error interno"): string {
  const err = obtenerError(error);
  const original = err.originalError;

  if (error instanceof AppError && error.expose) return error.message;
  if (original instanceof AppError && original.expose) return original.message;
  if (err.statusCode && err.statusCode < 500 && err.message) return err.message;

  return mensajeDefault;
}

function esErrorGraphQLExponible(error: ErrorConDatos) {
  const code = error.extensions?.code || error.code;
  return code === "GRAPHQL_VALIDATION_FAILED"
    || code === "GRAPHQL_PARSE_FAILED"
    || error.message.startsWith("Unknown type ")
    || error.message.startsWith("Cannot query field ")
    || error.message.startsWith("Variable \"$")
    || error.message.startsWith("Syntax Error");
}

function extraerFrameResolver(stack?: string) {
  if (!stack) return undefined;

  const lineas = stack.split("\n").map((linea) => linea.trim());
  for (const linea of lineas) {
    const match = linea.match(/at\s+(?:async\s+)?(.+?)\s+\((.+src[\\/]+graphql[\\/]+resolvers[\\/]+([^:]+)):(\d+):(\d+)\)/i);
    if (match) {
      return {
        funcion: match[1],
        archivo: match[3],
        ruta: match[2],
        linea: Number(match[4]),
        columna: Number(match[5]),
        frame: `${match[3]}:${match[4]}:${match[5]}`,
      };
    }
  }

  return undefined;
}

function truncarTexto(valor: string, max = 160) {
  return valor.length > max ? `${valor.slice(0, max)}...` : valor;
}

function esLlaveSensible(llave: string) {
  return /password|pwd|token|authorization|secret/i.test(llave);
}

function sanitizarValor(valor: unknown, llave?: string): unknown {
  if (llave && esLlaveSensible(llave)) {
    return "[REDACTED]";
  }

  if (valor === null || valor === undefined) return valor;

  if (typeof valor === "string") {
    return truncarTexto(valor);
  }

  if (typeof valor === "number" || typeof valor === "boolean") {
    return valor;
  }

  if (Array.isArray(valor)) {
    const max = 8;
    const items = valor.slice(0, max).map((item) => sanitizarValor(item));
    if (valor.length > max) {
      return {
        items,
        total: valor.length,
      };
    }
    return items;
  }

  if (typeof valor === "object") {
    const entries = Object.entries(valor as Record<string, unknown>);
    const max = 20;
    const sanitizado: Record<string, unknown> = {};
    for (const [index, [key, item]] of entries.entries()) {
      if (index >= max) {
        sanitizado.__restantes = entries.length - max;
        break;
      }
      sanitizado[key] = sanitizarValor(item, key);
    }
    return sanitizado;
  }

  return `${valor}`;
}

function resolverValorGraphQL(valor: ValueNode, variables: Record<string, unknown>): unknown {
  switch (valor.kind) {
    case Kind.VARIABLE:
      return variables[valor.name.value];
    case Kind.STRING:
    case Kind.ENUM:
    case Kind.BOOLEAN:
      return valor.value;
    case Kind.INT:
    case Kind.FLOAT:
      return Number(valor.value);
    case Kind.NULL:
      return null;
    case Kind.LIST:
      return valor.values.map((item) => resolverValorGraphQL(item, variables));
    case Kind.OBJECT:
      return valor.fields.reduce<Record<string, unknown>>((acc, field) => {
        acc[field.name.value] = resolverValorGraphQL(field.value, variables);
        return acc;
      }, {});
    default:
      return undefined;
  }
}

function extraerOperacionYArgs(req?: Request, path?: unknown) {
  const body = (req as any)?.body || {};
  const query = typeof body.query === "string" ? body.query : "";
  if (!query.trim()) return undefined;

  try {
    const ast = parse(query);
    const operationNameBody = typeof body.operationName === "string" ? body.operationName : undefined;
    const variables = typeof body.variables === "object" && body.variables !== null
      ? body.variables as Record<string, unknown>
      : {};
    const rootPath = Array.isArray(path) && path.length > 0 ? `${path[0]}` : undefined;

    const operacion = ast.definitions.find((definition) => {
      if (definition.kind !== Kind.OPERATION_DEFINITION) return false;
      if (operationNameBody) {
        return definition.name?.value === operationNameBody;
      }
      return true;
    });

    if (!operacion || operacion.kind !== Kind.OPERATION_DEFINITION) return undefined;

    const rootField = operacion.selectionSet.selections.find((selection) =>
      selection.kind === Kind.FIELD && (!rootPath || selection.name.value === rootPath)
    ) || operacion.selectionSet.selections.find((selection) => selection.kind === Kind.FIELD);

    if (!rootField || rootField.kind !== Kind.FIELD) {
      return {
        graphqlTipo: operacion.operation,
        graphqlOperacion: operacion.name?.value,
      };
    }

    const args = rootField.arguments?.reduce<Record<string, unknown>>((acc, arg) => {
      acc[arg.name.value] = sanitizarValor(resolverValorGraphQL(arg.value, variables), arg.name.value);
      return acc;
    }, {}) || {};

    return {
      graphqlTipo: operacion.operation,
      graphqlOperacion: operacion.name?.value,
      graphqlCampo: rootField.name.value,
      graphqlEndpoint: `${operacion.operation}.${rootField.name.value}`,
      graphqlArgs: Object.keys(args).length > 0 ? args : undefined,
      graphqlVariables: Object.keys(variables).length > 0 ? sanitizarValor(variables) : undefined,
    };
  } catch {
    return {
      graphqlOperacion: typeof body.operationName === "string" ? body.operationName : undefined,
      graphqlVariables: body.variables ? sanitizarValor(body.variables) : undefined,
      graphqlQuery: query ? truncarTexto(query.replace(/\s+/g, " "), 220) : undefined,
    };
  }
}

function filtrarStackRelevante(stack?: string) {
  if (!stack) return undefined;

  const lineas = stack.split("\n").map((linea) => linea.trim()).filter(Boolean);
  if (lineas.length === 0) return undefined;

  const encabezado = lineas[0];
  const relevantes = lineas.slice(1).filter((linea) => {
    if (/node_modules[\\/](graphql|express-graphql)/i.test(linea)) return false;
    if (/node:internal/i.test(linea)) return false;
    return /src[\\/]/i.test(linea) || /node_modules[\\/](mssql|oracledb|tedious)/i.test(linea);
  });

  if (relevantes.length === 0) {
    return undefined;
  }

  return [encabezado, ...relevantes.slice(0, 8)].join("\n");
}

export function registrarError(origen: string, error: unknown, extras?: Record<string, unknown>) {
  const err = obtenerError(error);
  const originalError = err.originalError;
  const path = (err as any).path || extras?.path;
  const resolver = Array.isArray(path) && path.length > 0 ? `${path[0]}` : undefined;
  const frameResolver = extraerFrameResolver(originalError?.stack || err.stack);
  const req = extras?.req as Request | undefined;
  const contextoGraphQL = extraerOperacionYArgs(req, path);
  const detalle = {
    ...Object.fromEntries(Object.entries(extras || {}).filter(([key]) => key !== "req")),
    httpMetodo: req?.method,
    httpPath: req?.originalUrl || req?.url,
    ...contextoGraphQL,
    ...(originalError?.details || {}),
    ...(err.details || {}),
    code: err.extensions?.code || err.code,
    path,
    resolver,
    resolverFrame: frameResolver?.frame,
    resolverArchivo: frameResolver?.archivo,
    resolverFuncion: frameResolver?.funcion,
    resolverLinea: frameResolver?.linea,
    resolverColumna: frameResolver?.columna,
    locations: (err as any).locations,
    originalError: originalError?.message,
  };
  const mensajeBase = `[${origen}] ${err.message}`;
  const detalleExtras = Object.values(detalle).some((valor) => valor !== undefined)
    ? ` | ${JSON.stringify(detalle)}`
    : "";

  if (err.code === "MSSQL_QUEUE_FULL") {
    const ahora = Date.now();
    if (ahora - ultimoAvisoColaMssql < 5000) {
      erroresColaMssqlSuprimidos++;
      return;
    }

    const suprimidos = erroresColaMssqlSuprimidos;
    erroresColaMssqlSuprimidos = 0;
    ultimoAvisoColaMssql = ahora;
    Utils.Mensaje(
      CONSOLA.WARNING,
      `${mensajeBase}${detalleExtras}${suprimidos > 0 ? ` | erroresSuprimidos=${suprimidos}` : ""}`
    );
    return;
  }

  Utils.Mensaje(CONSOLA.ERROR_SIN_TRACE, `${mensajeBase}${detalleExtras}`);

  const stackPrincipal = filtrarStackRelevante(err.stack)
    || filtrarStackRelevante(err.extensions?.exception?.stacktrace?.join("\n"));
  const stackOriginal = filtrarStackRelevante(originalError?.stack)
    || filtrarStackRelevante(originalError?.extensions?.exception?.stacktrace?.join("\n"));

  if (stackPrincipal) {
    console.error(stackPrincipal);
  }

  if (stackOriginal && stackOriginal !== stackPrincipal) {
    console.error(stackOriginal);
  }
}

export function responderErrorHTTP(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    return next(err);
  }

  const error = obtenerError(err);
  const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;

  registrarError("HTTP", error, {
    metodo: req.method,
    path: req.originalUrl,
  });

  return res.status(statusCode).json({
    ok: false,
    mensaje: mensajeSeguro(error),
  });
}

export function responderNoEncontrado(req: Request, res: Response) {
  return res.status(404).json({
    ok: false,
    mensaje: "Recurso no encontrado",
  });
}

export function manejarErrorGraphQL(error: ErrorConDatos, req?: Request) {
  const code = error.extensions?.code || error.code
    || (error.originalError instanceof AppError ? error.originalError.code : undefined)
    || "INTERNAL_SERVER_ERROR";

  registrarError("GraphQL", error, {
    code,
    req,
  });

  return {
    message: esErrorGraphQLExponible(error)
      ? error.message
      : mensajeSeguro(error, "Ocurrio un error al procesar la solicitud"),
    path: (error as any).path,
    extensions: {
      code,
    },
  };
}

let manejoGlobalRegistrado = false;
let ultimoAvisoColaMssql = 0;
let erroresColaMssqlSuprimidos = 0;

export function registrarManejoGlobalErrores() {
  if (manejoGlobalRegistrado) return;
  manejoGlobalRegistrado = true;

  process.on("unhandledRejection", (reason) => {
    registrarError("unhandledRejection", reason);
  });

  process.on("uncaughtException", (error) => {
    registrarError("uncaughtException", error);
  });
}
