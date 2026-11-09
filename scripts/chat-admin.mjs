// Live chat administration. Run from the project root:
//
//   node --env-file=.env scripts/chat-admin.mjs mod someone@gmail.com     grant the moderator role
//   node --env-file=.env scripts/chat-admin.mjs unmod someone@gmail.com   remove it
//   node --env-file=.env scripts/chat-admin.mjs unban someone@gmail.com   lift a chat ban
//   node --env-file=.env scripts/chat-admin.mjs analytics someone@gmail.com     let them see the private
//   node --env-file=.env scripts/chat-admin.mjs unanalytics someone@gmail.com   analytics (listener details)
//
// The person must have signed in on the site once (e.g. on /analytics). Role changes apply after they sign out and
// back in.
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';

const [command, who] = process.argv.slice(2);
const { FIREBASE_SERVICE_ACCOUNT, PUBLIC_FIREBASE_DATABASE_URL } = process.env;

// Each role is a custom claim on the Google account: `mod` for the chat, `analytics` for /analytics.
const roles = {
	mod: { claim: 'mod', grant: true, name: 'moderator' },
	unmod: { claim: 'mod', grant: false, name: 'moderator' },
	analytics: { claim: 'analytics', grant: true, name: 'analytics' },
	unanalytics: { claim: 'analytics', grant: false, name: 'analytics' },
};

if (!(command in roles || command === 'unban') || !who) {
	console.error('Usage: node --env-file=.env scripts/chat-admin.mjs <mod|unmod|analytics|unanalytics|unban> <email or uid>');
	process.exit(1);
}
if (!FIREBASE_SERVICE_ACCOUNT || !PUBLIC_FIREBASE_DATABASE_URL) {
	console.error('FIREBASE_SERVICE_ACCOUNT and PUBLIC_FIREBASE_DATABASE_URL must be set (see .env).');
	process.exit(1);
}

initializeApp({ credential: cert(JSON.parse(FIREBASE_SERVICE_ACCOUNT)), databaseURL: PUBLIC_FIREBASE_DATABASE_URL });
const auth = getAuth();
const user = who.includes('@') ? await auth.getUserByEmail(who) : await auth.getUser(who);
const label = `${user.displayName ?? user.email} (${user.uid})`;

if (command === 'unban') {
	const database = getDatabase();
	await database.ref(`chat/private/bans/${user.uid}`).remove();
	await database.ref(`chat/private/users/${user.uid}/mutedUntil`).remove();
	console.log(`Unbanned ${label}.`);
} else {
	const role = roles[command];
	const { [role.claim]: _, ...otherClaims } = user.customClaims ?? {};
	await auth.setCustomUserClaims(user.uid, role.grant ? { ...otherClaims, [role.claim]: true } : otherClaims);
	console.log(`${role.grant ? 'Granted' : 'Removed'} the ${role.name} role for ${label}.`);
}
process.exit(0);
