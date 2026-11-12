// What a CMS role allows in the YouTube integration. Pure, so it is tested on its own (roles.test.ts).

export type LivestreamAccess = 'manage' | 'view';

/** Developer: connect, disconnect and switch the sync. Digital: look only. Any other role (and chat roles): nothing. */
export const accessFromRoles = (roles: readonly string[]): LivestreamAccess | null => {
	if (roles.includes('developer')) return 'manage';
	if (roles.includes('digital')) return 'view';
	return null;
};

export const allows = (access: LivestreamAccess | null, needed: LivestreamAccess) =>
	access === 'manage' || (access === 'view' && needed === 'view');
