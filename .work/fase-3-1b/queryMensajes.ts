import { IBitacora, Log } from './../../clases/Log';
import { IResolvers } from "@graphql-tools/utils";
import { Chat, IChat, IChatPrivadoUsuario, IMensajesContador, IReaccion } from "../../clases/Chat";
import { AppError } from '../../system/errorHandling';
import { aseguraMismoUsuario, requiereAutenticacion } from '../../system/auth';

const queryMensajes: IResolvers = {
    Query: {
        async mensajesChat(parent, args, context, info): Promise<IChat[]> {
            await requiereAutenticacion(context, args, { allowLegacyArgs: false });
            let i = await Chat.getInstancia().getMensajesChat(args.sala, args.ultimos);
            return i;
        },
        async chatsPrivadosUsuario(parent, args, context, info): Promise<IChatPrivadoUsuario[]> {
            const auth = await requiereAutenticacion(context, args, { allowLegacyArgs: false });
            aseguraMismoUsuario(auth, args);
            return await Chat.getInstancia().chatsPrivadosUsuario(args.usuario);
        },
        async mensajesChatContador(parent, args, context, info): Promise<IMensajesContador> {
            const auth = await requiereAutenticacion(context, args, { allowLegacyArgs: false });
            aseguraMismoUsuario(auth, args);
            let i = await Chat.getInstancia().mensajesChatContador(args.sala, args.usuario);
            return i;
        },
        async mensajeChat(parent, args, context, info): Promise<IChat | undefined> {
            await requiereAutenticacion(context, args, { allowLegacyArgs: false });
            let i = await Chat.getInstancia().getMensaje(args.id);
            return i;
        },
        async reaccionarMensaje(parent, args, context, info): Promise<boolean> {
            const auth = await requiereAutenticacion(context, args, { allowLegacyArgs: false });
            aseguraMismoUsuario(auth, args);
            let i = await Chat.getInstancia().reaccionarMensaje(args.id, args.usuario, args.reaccion);
            return i;
        },
        async reaccionarSala(parent, args, context, info): Promise<boolean> {
            const auth = await requiereAutenticacion(context, args, { allowLegacyArgs: false });
            aseguraMismoUsuario(auth, args);
            let i = await Chat.getInstancia().reaccionarSala(args.sala, args.usuario, args.reaccion);
            return i;
        },
        async marcarLeidos(parent, args, context, info): Promise<boolean> {
            const auth = await requiereAutenticacion(context, args, { allowLegacyArgs: false });
            aseguraMismoUsuario(auth, args);
            let i = Chat.getInstancia().marcarLeidos(args.sala, args.usuario, args.leidos);
            return i;
        },
        async reaccionesSala(parent, args, context, info): Promise<IReaccion[]> {
            await requiereAutenticacion(context, args, { allowLegacyArgs: false });
            let i = await Chat.getInstancia().reaccionesSalaDetalle(args.sala);
            return i;
        },
        async guardarBitacora(parent, args, context, info): Promise<boolean | Error> {
            await requiereAutenticacion(context, args, { allowLegacyArgs: false });
            throw new AppError(
                'La escritura pública de bitácora no está disponible. Actualiza la aplicación para guardar cambios.',
                403,
                'AUDITORIA_PUBLICA_NO_DISPONIBLE'
            );
        },
        async bitacoraGrupo(parent, args, context, info): Promise<Array<IBitacora> | Error> {
            const auth = await requiereAutenticacion(context, args, { allowLegacyArgs: false });
            aseguraMismoUsuario(auth, args);
            return await Log.getInstancia().bitacoraGrupo(args.grupo, args.periodo);
        },
    }
}

export default queryMensajes;
