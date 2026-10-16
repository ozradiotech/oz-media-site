// Live chat administration. Run from the project root:
//
//   node --env-file=.env scripts/chat-admin.mjs mod someone@gmail.com     grant the moderator role
//   node --env-file=.env scripts/chat-admin.mjs unmod someone@gmail.com   remove it
//   node --env-file=.env scripts/chat-admin.mjs unban someone@gmail.com   lift a chat ban
//
// The person must have signed in on the site once. Role changes apply after they sign out and back in.
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';

const [command, who] = process.argv.slice(2);
const { FIREBASE_SERVICE_ACCOUNT, PUBLIC_FIREBASE_DATABASE_URL } = process.env;

if (!['mod', 'unmod', 'unban'].includes(command) || !who) {
	console.error('Usage: node --env-file=.env scripts/chat-admin.mjs <mod|unmod|unban> <email or uid>');
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
	const { mod: _, ...otherClaims } = user.customClaims ?? {};
	await auth.setCustomUserClaims(user.uid, command === 'mod' ? { ...otherClaims, mod: true } : otherClaims);
	console.log(`${command === 'mod' ? 'Granted' : 'Removed'} the moderator role for ${label}.`);
}
process.exit(0);
