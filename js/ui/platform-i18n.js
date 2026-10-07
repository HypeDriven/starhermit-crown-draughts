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
    expiredTitle: 'Your session expired', expiredBody: 'Your StarHermit session has ended, so online play stopped. Head back to StarHermit to start a fresh session.',
    relaunch: 'Back to StarHermit', keepPlaying: 'Keep playing here', relaunchFailed: 'Could not open StarHermit — reopen the game from StarHermit.',
  },
  'en-GB': {
    signIn: 'Sign in with StarHermit', invite: 'Invite a friend', copied: 'Invite link copied to the clipboard.',
    copyFail: 'Could not copy — invite link: {link}', signedOut: 'Signed out of StarHermit — playing on this device.',
    playingAs: 'Playing as {name}', inviteFriends: 'Invite friends to this table', noFriends: 'No friends to invite yet.',
    online: 'online', offline: 'offline', sendInvite: 'Invite', invited: 'Invited', inviteFailed: 'Invite failed.',
    tableInvites: 'Table invites', noInvites: 'No table invites right now.', join: 'Join', from: 'From {name}',
    expiredTitle: 'Your session expired', expiredBody: 'Your StarHermit session has ended, so online play has stopped. Head back to StarHermit to start a fresh session.',
    relaunch: 'Back to StarHermit', keepPlaying: 'Keep playing here', relaunchFailed: 'Could not open StarHermit — reopen the game from StarHermit.',
  },
  'es-419': {
    signIn: 'Iniciar sesión con StarHermit', invite: 'Invitar a un amigo', copied: 'Enlace de invitación copiado al portapapeles.',
    copyFail: 'No se pudo copiar. Enlace de invitación: {link}', signedOut: 'Sesión de StarHermit cerrada: juegas en este dispositivo.',
    playingAs: 'Jugando como {name}', inviteFriends: 'Invitar amigos a esta mesa', noFriends: 'Todavía no tienes amigos para invitar.',
    online: 'en línea', offline: 'desconectado', sendInvite: 'Invitar', invited: 'Invitado', inviteFailed: 'No se pudo invitar.',
    tableInvites: 'Invitaciones a mesas', noInvites: 'No hay invitaciones a mesas por ahora.', join: 'Unirse', from: 'De {name}',
    expiredTitle: 'Tu sesión expiró', expiredBody: 'Tu sesión de StarHermit terminó y el juego en línea se detuvo. Vuelve a StarHermit para iniciar una sesión nueva.',
    relaunch: 'Volver a StarHermit', keepPlaying: 'Seguir jugando aquí', relaunchFailed: 'No se pudo abrir StarHermit. Vuelve a abrir el juego desde StarHermit.',
  },
  'es-ES': {
    signIn: 'Iniciar sesión con StarHermit', invite: 'Invitar a un amigo', copied: 'Enlace de invitación copiado al portapapeles.',
    copyFail: 'No se ha podido copiar. Enlace de invitación: {link}', signedOut: 'Sesión de StarHermit cerrada: juegas en este dispositivo.',
    playingAs: 'Jugando como {name}', inviteFriends: 'Invitar amigos a esta mesa', noFriends: 'Aún no tienes amigos a los que invitar.',
    online: 'conectado', offline: 'desconectado', sendInvite: 'Invitar', invited: 'Invitado', inviteFailed: 'No se ha podido invitar.',
    tableInvites: 'Invitaciones a mesas', noInvites: 'Ahora mismo no hay invitaciones a mesas.', join: 'Unirse', from: 'De {name}',
    expiredTitle: 'Tu sesión ha caducado', expiredBody: 'Tu sesión de StarHermit ha terminado y el juego en línea se ha detenido. Vuelve a StarHermit para iniciar una sesión nueva.',
    relaunch: 'Volver a StarHermit', keepPlaying: 'Seguir jugando aquí', relaunchFailed: 'No se ha podido abrir StarHermit. Vuelve a abrir el juego desde StarHermit.',
  },
  'de-DE': {
    signIn: 'Mit StarHermit anmelden', invite: 'Freund einladen', copied: 'Einladungslink in die Zwischenablage kopiert.',
    copyFail: 'Kopieren fehlgeschlagen – Einladungslink: {link}', signedOut: 'Von StarHermit abgemeldet – du spielst auf diesem Gerät.',
    playingAs: 'Du spielst als {name}', inviteFriends: 'Freunde an diesen Tisch einladen', noFriends: 'Noch keine Freunde zum Einladen.',
    online: 'online', offline: 'offline', sendInvite: 'Einladen', invited: 'Eingeladen', inviteFailed: 'Einladung fehlgeschlagen.',
    tableInvites: 'Tisch-Einladungen', noInvites: 'Zurzeit keine Tisch-Einladungen.', join: 'Beitreten', from: 'Von {name}',
    expiredTitle: 'Deine Sitzung ist abgelaufen', expiredBody: 'Deine StarHermit-Sitzung ist beendet, daher wurde das Online-Spiel gestoppt. Kehre zu StarHermit zurück, um eine neue Sitzung zu starten.',
    relaunch: 'Zurück zu StarHermit', keepPlaying: 'Hier weiterspielen', relaunchFailed: 'StarHermit konnte nicht geöffnet werden – starte das Spiel erneut über StarHermit.',
  },
  'fr-FR': {
    signIn: 'Se connecter avec StarHermit', invite: 'Inviter un ami', copied: 'Lien d’invitation copié dans le presse-papiers.',
    copyFail: 'Copie impossible — lien d’invitation : {link}', signedOut: 'Déconnecté de StarHermit — vous jouez sur cet appareil.',
    playingAs: 'Vous jouez en tant que {name}', inviteFriends: 'Inviter des amis à cette table', noFriends: 'Aucun ami à inviter pour l’instant.',
    online: 'en ligne', offline: 'hors ligne', sendInvite: 'Inviter', invited: 'Invité', inviteFailed: 'Échec de l’invitation.',
    tableInvites: 'Invitations à une table', noInvites: 'Aucune invitation à une table pour le moment.', join: 'Rejoindre', from: 'De {name}',
    expiredTitle: 'Votre session a expiré', expiredBody: 'Votre session StarHermit est terminée : le jeu en ligne s’est arrêté. Retournez sur StarHermit pour ouvrir une nouvelle session.',
    relaunch: 'Retour à StarHermit', keepPlaying: 'Continuer à jouer ici', relaunchFailed: 'Impossible d’ouvrir StarHermit — relancez le jeu depuis StarHermit.',
  },
  'fr-CA': {
    signIn: 'Se connecter avec StarHermit', invite: 'Inviter un ami', copied: 'Lien d’invitation copié dans le presse-papiers.',
    copyFail: 'Copie impossible — lien d’invitation : {link}', signedOut: 'Déconnecté de StarHermit — vous jouez sur cet appareil.',
    playingAs: 'Vous jouez en tant que {name}', inviteFriends: 'Inviter des amis à cette table', noFriends: 'Aucun ami à inviter pour le moment.',
    online: 'en ligne', offline: 'hors ligne', sendInvite: 'Inviter', invited: 'Invité', inviteFailed: 'L’invitation a échoué.',
    tableInvites: 'Invitations à une table', noInvites: 'Aucune invitation à une table pour le moment.', join: 'Rejoindre', from: 'De {name}',
    expiredTitle: 'Votre session a expiré', expiredBody: 'Votre session StarHermit est terminée : le jeu en ligne s’est arrêté. Retournez sur StarHermit pour ouvrir une nouvelle session.',
    relaunch: 'Retour à StarHermit', keepPlaying: 'Continuer à jouer ici', relaunchFailed: 'Impossible d’ouvrir StarHermit — relancez le jeu à partir de StarHermit.',
  },
  'pt-BR': {
    signIn: 'Entrar com StarHermit', invite: 'Convidar um amigo', copied: 'Link de convite copiado para a área de transferência.',
    copyFail: 'Não foi possível copiar — link de convite: {link}', signedOut: 'Você saiu do StarHermit — jogando neste dispositivo.',
    playingAs: 'Jogando como {name}', inviteFriends: 'Convidar amigos para esta mesa', noFriends: 'Ainda não há amigos para convidar.',
    online: 'online', offline: 'offline', sendInvite: 'Convidar', invited: 'Convidado', inviteFailed: 'Falha ao convidar.',
    tableInvites: 'Convites para mesas', noInvites: 'Nenhum convite para mesas no momento.', join: 'Entrar', from: 'De {name}',
    expiredTitle: 'Sua sessão expirou', expiredBody: 'Sua sessão do StarHermit terminou e o jogo online parou. Volte ao StarHermit para iniciar uma nova sessão.',
    relaunch: 'Voltar ao StarHermit', keepPlaying: 'Continuar jogando aqui', relaunchFailed: 'Não foi possível abrir o StarHermit — abra o jogo novamente pelo StarHermit.',
  },
  'it-IT': {
    signIn: 'Accedi con StarHermit', invite: 'Invita un amico', copied: 'Link di invito copiato negli appunti.',
    copyFail: 'Impossibile copiare. Link di invito: {link}', signedOut: 'Disconnesso da StarHermit: giochi su questo dispositivo.',
    playingAs: 'Giochi come {name}', inviteFriends: 'Invita amici a questo tavolo', noFriends: 'Ancora nessun amico da invitare.',
    online: 'online', offline: 'offline', sendInvite: 'Invita', invited: 'Invitato', inviteFailed: 'Invito non riuscito.',
    tableInvites: 'Inviti ai tavoli', noInvites: 'Nessun invito ai tavoli al momento.', join: 'Unisciti', from: 'Da {name}',
    expiredTitle: 'La tua sessione è scaduta', expiredBody: 'La tua sessione StarHermit è terminata e il gioco online si è interrotto. Torna su StarHermit per avviare una nuova sessione.',
    relaunch: 'Torna a StarHermit', keepPlaying: 'Continua a giocare qui', relaunchFailed: 'Impossibile aprire StarHermit: riapri il gioco da StarHermit.',
  },
};

export function platformStrings(tag = globalThis.navigator?.language) {
  return PLATFORM_STRINGS[pickLocale(tag)] || PLATFORM_STRINGS['en-US'];
}

export function pfmt(s, vars) {
  return String(s).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
}
