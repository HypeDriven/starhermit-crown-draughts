// StarHermit UI strings (sign-in, invite link, table invites, friends picker)
// for the nine supported locales. Locale follows navigator.language through
// the same picker as the Graphics strings.

import { pickLocale } from './gfx-i18n.js';

export const PLATFORM_STRINGS = {
  'en-US': {
    signIn: 'Sign in with StarHermit', invite: 'Invite a friend', copied: 'Invite link copied to the clipboard.',
    copyFail: 'Could not copy — invite link: {link}', signedOut: 'Signed out of StarHermit — playing on this device.',
    playingAs: 'Playing as {name}', inviteFriends: 'Invite friends to this table', noFriends: 'No friends to invite yet.',
    online: 'online', offline: 'offline', sendInvite: 'Invite', invited: 'Invited', inviteFailed: 'Invite failed.',
    tableInvites: 'Table invites', noInvites: 'No table invites right now.', join: 'Join', from: 'From {name}',
  },
  'en-GB': {
    signIn: 'Sign in with StarHermit', invite: 'Invite a friend', copied: 'Invite link copied to the clipboard.',
    copyFail: 'Could not copy — invite link: {link}', signedOut: 'Signed out of StarHermit — playing on this device.',
    playingAs: 'Playing as {name}', inviteFriends: 'Invite friends to this table', noFriends: 'No friends to invite yet.',
    online: 'online', offline: 'offline', sendInvite: 'Invite', invited: 'Invited', inviteFailed: 'Invite failed.',
    tableInvites: 'Table invites', noInvites: 'No table invites right now.', join: 'Join', from: 'From {name}',
  },
  'es-419': {
    signIn: 'Iniciar sesión con StarHermit', invite: 'Invitar a un amigo', copied: 'Enlace de invitación copiado al portapapeles.',
    copyFail: 'No se pudo copiar. Enlace de invitación: {link}', signedOut: 'Sesión de StarHermit cerrada: juegas en este dispositivo.',
    playingAs: 'Jugando como {name}', inviteFriends: 'Invitar amigos a esta mesa', noFriends: 'Todavía no tienes amigos para invitar.',
    online: 'en línea', offline: 'desconectado', sendInvite: 'Invitar', invited: 'Invitado', inviteFailed: 'No se pudo invitar.',
    tableInvites: 'Invitaciones a mesas', noInvites: 'No hay invitaciones a mesas por ahora.', join: 'Unirse', from: 'De {name}',
  },
  'es-ES': {
    signIn: 'Iniciar sesión con StarHermit', invite: 'Invitar a un amigo', copied: 'Enlace de invitación copiado al portapapeles.',
    copyFail: 'No se ha podido copiar. Enlace de invitación: {link}', signedOut: 'Sesión de StarHermit cerrada: juegas en este dispositivo.',
    playingAs: 'Jugando como {name}', inviteFriends: 'Invitar amigos a esta mesa', noFriends: 'Aún no tienes amigos a los que invitar.',
    online: 'conectado', offline: 'desconectado', sendInvite: 'Invitar', invited: 'Invitado', inviteFailed: 'No se ha podido invitar.',
    tableInvites: 'Invitaciones a mesas', noInvites: 'Ahora mismo no hay invitaciones a mesas.', join: 'Unirse', from: 'De {name}',
  },
  'de-DE': {
    signIn: 'Mit StarHermit anmelden', invite: 'Freund einladen', copied: 'Einladungslink in die Zwischenablage kopiert.',
    copyFail: 'Kopieren fehlgeschlagen – Einladungslink: {link}', signedOut: 'Von StarHermit abgemeldet – du spielst auf diesem Gerät.',
    playingAs: 'Du spielst als {name}', inviteFriends: 'Freunde an diesen Tisch einladen', noFriends: 'Noch keine Freunde zum Einladen.',
    online: 'online', offline: 'offline', sendInvite: 'Einladen', invited: 'Eingeladen', inviteFailed: 'Einladung fehlgeschlagen.',
    tableInvites: 'Tisch-Einladungen', noInvites: 'Zurzeit keine Tisch-Einladungen.', join: 'Beitreten', from: 'Von {name}',
  },
  'fr-FR': {
    signIn: 'Se connecter avec StarHermit', invite: 'Inviter un ami', copied: 'Lien d’invitation copié dans le presse-papiers.',
    copyFail: 'Copie impossible — lien d’invitation : {link}', signedOut: 'Déconnecté de StarHermit — vous jouez sur cet appareil.',
    playingAs: 'Vous jouez en tant que {name}', inviteFriends: 'Inviter des amis à cette table', noFriends: 'Aucun ami à inviter pour l’instant.',
    online: 'en ligne', offline: 'hors ligne', sendInvite: 'Inviter', invited: 'Invité', inviteFailed: 'Échec de l’invitation.',
    tableInvites: 'Invitations à une table', noInvites: 'Aucune invitation à une table pour le moment.', join: 'Rejoindre', from: 'De {name}',
  },
  'fr-CA': {
    signIn: 'Se connecter avec StarHermit', invite: 'Inviter un ami', copied: 'Lien d’invitation copié dans le presse-papiers.',
    copyFail: 'Copie impossible — lien d’invitation : {link}', signedOut: 'Déconnecté de StarHermit — vous jouez sur cet appareil.',
    playingAs: 'Vous jouez en tant que {name}', inviteFriends: 'Inviter des amis à cette table', noFriends: 'Aucun ami à inviter pour le moment.',
    online: 'en ligne', offline: 'hors ligne', sendInvite: 'Inviter', invited: 'Invité', inviteFailed: 'L’invitation a échoué.',
    tableInvites: 'Invitations à une table', noInvites: 'Aucune invitation à une table pour le moment.', join: 'Rejoindre', from: 'De {name}',
  },
  'pt-BR': {
    signIn: 'Entrar com StarHermit', invite: 'Convidar um amigo', copied: 'Link de convite copiado para a área de transferência.',
    copyFail: 'Não foi possível copiar — link de convite: {link}', signedOut: 'Você saiu do StarHermit — jogando neste dispositivo.',
    playingAs: 'Jogando como {name}', inviteFriends: 'Convidar amigos para esta mesa', noFriends: 'Ainda não há amigos para convidar.',
    online: 'online', offline: 'offline', sendInvite: 'Convidar', invited: 'Convidado', inviteFailed: 'Falha ao convidar.',
    tableInvites: 'Convites para mesas', noInvites: 'Nenhum convite para mesas no momento.', join: 'Entrar', from: 'De {name}',
  },
  'it-IT': {
    signIn: 'Accedi con StarHermit', invite: 'Invita un amico', copied: 'Link di invito copiato negli appunti.',
    copyFail: 'Impossibile copiare. Link di invito: {link}', signedOut: 'Disconnesso da StarHermit: giochi su questo dispositivo.',
    playingAs: 'Giochi come {name}', inviteFriends: 'Invita amici a questo tavolo', noFriends: 'Ancora nessun amico da invitare.',
    online: 'online', offline: 'offline', sendInvite: 'Invita', invited: 'Invitato', inviteFailed: 'Invito non riuscito.',
    tableInvites: 'Inviti ai tavoli', noInvites: 'Nessun invito ai tavoli al momento.', join: 'Unisciti', from: 'Da {name}',
  },
};

export function platformStrings(tag = globalThis.navigator?.language) {
  return PLATFORM_STRINGS[pickLocale(tag)] || PLATFORM_STRINGS['en-US'];
}

export function pfmt(s, vars) {
  return String(s).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
}
