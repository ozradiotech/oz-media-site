import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';

export type OzUser = Pick<User, 'uid' | 'displayName' | 'email' | 'photoURL'>;

export interface OzAuth {
	/** The signed-in user, or null. Resolves once Firebase has restored any saved session. */
	ready(): Promise<OzUser | null>;
	currentUser(): OzUser | null;
	signIn(): Promise<OzUser>;
	signOut(): Promise<void>;
	onChange(callback: (user: OzUser | null) => void): () => void;
}

// The Firebase web config is public by design; access is controlled by the authorized domains in the console.
const firebaseConfig = {
	apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY,
	authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
	projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID,
	appId: import.meta.env.PUBLIC_FIREBASE_APP_ID,
};

export const isAuthConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId);

export const createOzAuth = (): OzAuth => {
	if (!isAuthConfigured) throw new Error('Google sign-in is not configured.');

	const auth = getAuth(initializeApp(firebaseConfig));
	const provider = new GoogleAuthProvider();
	provider.setCustomParameters({ prompt: 'select_account' });

	return {
		ready: () => auth.authStateReady().then(() => auth.currentUser),
		currentUser: () => auth.currentUser,
		// Popup rather than redirect: redirect sign-in breaks in browsers that partition third-party storage.
		signIn: () => signInWithPopup(auth, provider).then(({ user }) => user),
		signOut: () => signOut(auth),
		onChange: (callback) => onAuthStateChanged(auth, callback),
	};
};
