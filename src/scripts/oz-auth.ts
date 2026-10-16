import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { getOzFirebaseApp, isFirebaseConfigured } from './oz-firebase';

export type OzUser = Pick<User, 'uid' | 'displayName' | 'email' | 'photoURL'>;

export interface OzAuth {
	/** The signed-in user, or null. Resolves once Firebase has restored any saved session. */
	ready(): Promise<OzUser | null>;
	currentUser(): OzUser | null;
	signIn(): Promise<OzUser>;
	signOut(): Promise<void>;
	onChange(callback: (user: OzUser | null) => void): () => void;
	/** A fresh Firebase ID token for our API routes, or null when signed out. */
	idToken(): Promise<string | null>;
	/** Whether the signed-in user has the chat moderator claim (set with scripts/chat-admin.mjs). */
	isModerator(): Promise<boolean>;
}

export const isAuthConfigured = isFirebaseConfigured;

export const createOzAuth = (): OzAuth => {
	if (!isAuthConfigured) throw new Error('Google sign-in is not configured.');

	const auth = getAuth(getOzFirebaseApp());
	const provider = new GoogleAuthProvider();
	provider.setCustomParameters({ prompt: 'select_account' });

	return {
		ready: () => auth.authStateReady().then(() => auth.currentUser),
		currentUser: () => auth.currentUser,
		// Popup rather than redirect: redirect sign-in breaks in browsers that partition third-party storage.
		signIn: () => signInWithPopup(auth, provider).then(({ user }) => user),
		signOut: () => signOut(auth),
		onChange: (callback) => onAuthStateChanged(auth, callback),
		idToken: () => auth.currentUser?.getIdToken() ?? Promise.resolve(null),
		isModerator: async () => {
			const result = await auth.currentUser?.getIdTokenResult().catch(() => undefined);
			return result?.claims.mod === true;
		},
	};
};
