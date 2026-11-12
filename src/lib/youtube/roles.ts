// What a CMS user may do with the website's admin features, as the CMS works it out from their built-in and custom
// roles (oz-cms src/permissions.ts) and sends with its tokens and role lookups. Pure, so it is tested on its own.
//
//   youtube     Broadcast → YouTube: connect, check now, quota saver
//   chatSync    Live chat → YouTube chat sync: the two directions
//   moderation  Live chat → Moderation: bans
//   analytics   Digital → Analytics (view only)
//
// Levels: none < view < edit ("manage" in the admin).

export type Level = 'none' | 'view' | 'edit';
export type Capability = 'youtube' | 'chatSync' | 'moderation' | 'analytics';
export type Capabilities = Record<Capability, Level>;

const levels: Level[] = ['none', 'view', 'edit'];
const capabilityNames: Capability[] = ['youtube', 'chatSync', 'moderation', 'analytics'];

export const noCapabilities: Capabilities = { youtube: 'none', chatSync: 'none', moderation: 'none', analytics: 'none' };

/**
 * The capabilities the CMS sent. A CMS from before custom roles sent only role names: then Developer has everything
 * and Digital the analytics, as the built-in roles still do.
 */
export const capabilitiesFrom = (sent: unknown, roles: readonly string[]): Capabilities => {
	if (sent && typeof sent === 'object') {
		const value = sent as Record<string, unknown>;
		return Object.fromEntries(capabilityNames.map((name) => [name, levels.includes(value[name] as Level) ? value[name] : 'none'])) as Capabilities;
	}
	if (roles.includes('developer')) return { youtube: 'edit', chatSync: 'edit', moderation: 'edit', analytics: 'view' };
	if (roles.includes('digital')) return { ...noCapabilities, analytics: 'view' };
	return noCapabilities;
};

export const allows = (level: Level | null | undefined, needed: 'view' | 'edit') => levels.indexOf(level ?? 'none') >= levels.indexOf(needed);

/** As the admin pages say it: 'manage', 'view', or null. */
export const accessLabel = (level: Level) => (level === 'edit' ? 'manage' : level === 'view' ? 'view' : null);
