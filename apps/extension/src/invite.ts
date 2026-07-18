export function formatInviteCommand(characterName: string, realm: string): string {
  const inviteRealm = realm.replace(/[^A-Za-z0-9]/g, "");
  return `/invite ${characterName}-${inviteRealm}`;
}
