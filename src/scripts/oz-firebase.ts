import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';

// The Firebase web config is public by design; access is controlled by the authorized domains in the console
// and, for the chat database, by database.rules.json.
const firebaseConfig = {
	apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY,
	authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
	projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID,
	appId: import.meta.env.PUBLIC_FIREBASE_APP_ID,
	databaseURL: import.meta.env.PUBLIC_FIREBASE_DATABASE_URL,
};
const appCheckSiteKey: string | undefined = import.meta.env.PUBLIC_FIREBASE_APPCHECK_SITE_KEY;

export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId);
export const isChatConfigured = isFirebaseConfigured && Boolean(firebaseConfig.databaseURL);

let appCheck: AppCheck | undefined;

/** The shared Firebase app. App Check (when a site key is set) starts with it, so every SDK attaches its token. */
export const getOzFirebaseApp = (): FirebaseApp => {
	if (!isFirebaseConfigured) throw new Error('Firebase is not configured.');
	if (getApps().length) return getApp();

	const app = initializeApp(firebaseConfig);
	if (appCheckSiteKey) {
		appCheck = initializeAppCheck(app, {
			provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
			isTokenAutoRefreshEnabled: true,
		});
	}
	return app;
};

/** An App Check token for our own API routes, or null when App Check is off or unavailable. */
export const getAppCheckToken = async (): Promise<string | null> => {
	if (!appCheck) return null;
	try {
		return (await getToken(appCheck)).token;
	} catch (error) {
		// Usually a site key that doesn't match the one registered in App Check, or a domain missing from the key.
		console.warn('App Check token unavailable:', error);
		return null;
	}
};
