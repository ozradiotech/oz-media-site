import { getDatabase, goOffline, goOnline, limitToLast, onChildAdded, onChildRemoved, onValue, orderByKey, query, ref } from 'firebase/database';
import type { OzAuth, OzUser } from './oz-auth';
import { getAppCheckToken, getOzFirebaseApp, isChatConfigured } from './oz-firebase';
import { chatRoles, isChatRole, type ChatRole } from '../lib/chat-events';
import { sendEvents, tabId } from './oz-events';
import { track } from './oz-track';

// Live chat. Anyone can read it straight from the Realtime Database; sending, reporting and moderating go
// through /api/chat and /api/chat-mod (see src/lib/chat-server.ts), which check the signed-in Google account.

type ChatMessage = { u: string; n: string; p?: string; t: string; ts: number; m?: boolean; r?: string };
type ChatAction = 'report' | 'delete' | 'timeout' | 'ban';

// Only this many recent messages are downloaded and kept on the page (database.rules.json enforces the cap).
const messageLimit = 100;
// Mirrors the server's minimum gap between messages, so the send button can count down.
const minIntervalSeconds = 3;
// Background tabs and a scrolled-away chat drop their database connection after this long.
const idleDisconnectDelay = 2 * 60_000;
const timeoutMinutes = 10;

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

const isChatMessage = (value: unknown): value is ChatMessage => {
	if (!value || typeof value !== 'object') return false;
	const message = value as Record<string, unknown>;
	return typeof message.u === 'string' && typeof message.n === 'string' && typeof message.t === 'string';
};

const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

/** The Google profile picture, or the name's first letter when there is none or it fails to load. */
const createAvatar = (name: string, photo?: string | null) => {
	const initial = document.createElement('span');
	initial.className = 'chat-avatar';
	initial.textContent = [...name.trim()][0]?.toUpperCase() ?? '?';
	initial.setAttribute('aria-hidden', 'true');
	if (!photo?.startsWith('https://')) return initial;

	const image = document.createElement('img');
	image.className = 'chat-avatar';
	image.alt = '';
	image.width = 28;
	image.height = 28;
	image.loading = 'lazy';
	image.decoding = 'async';
	// Google's image servers refuse some requests that carry a referrer.
	image.referrerPolicy = 'no-referrer';
	image.addEventListener('error', () => image.replaceWith(initial), { once: true });
	image.src = photo;
	return image;
};

export interface OzChatOptions {
	room: string;
	/** Loads the page's shared Google sign-in (src/scripts/oz-auth.ts). */
	loadAuth: () => Promise<OzAuth | undefined>;
	/** Aborts when the visitor leaves the page: the chat then stops listening and lets its connection go. */
	signal: AbortSignal;
}

export const mountOzChat = async (root: HTMLElement, { room, loadAuth, signal }: OzChatOptions) => {
	const list = root.querySelector<HTMLOListElement>('[data-chat-messages]');
	const empty = root.querySelector<HTMLElement>('[data-chat-empty]');
	const status = root.querySelector<HTMLElement>('[data-chat-status]');
	const jump = root.querySelector<HTMLButtonElement>('[data-chat-jump]');
	const signIn = root.querySelector<HTMLButtonElement>('[data-chat-signin]');
	const account = root.querySelector<HTMLElement>('[data-chat-account]');
	const accountName = account?.querySelector<HTMLElement>('[data-chat-account-name]');
	const signOut = account?.querySelector<HTMLButtonElement>('[data-chat-signout]');
	const form = root.querySelector<HTMLFormElement>('[data-chat-form]');
	const input = form?.querySelector<HTMLInputElement>('input[name="message"]');
	const sendButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
	const selfAvatar = form?.querySelector<HTMLElement>('[data-chat-self-avatar]');
	const slowModeLabel = root.querySelector<HTMLElement>('[data-chat-slow-mode]');
	const modControl = root.querySelector<HTMLElement>('[data-chat-mod-control]');
	const slowModeSelect = modControl?.querySelector<HTMLSelectElement>('select');
	const menu = root.querySelector<HTMLElement>('[data-chat-menu]');
	const menuActions = menu ? [...menu.querySelectorAll<HTMLButtonElement>('[data-chat-action]')] : [];
	if (!list || !empty || !status || !jump || !signIn || !form || !input || !sendButton || !selfAvatar || !menu) return;

	// Whatever must stop when the visitor leaves the page.
	const onAbort = (stop: () => void) => signal.addEventListener('abort', stop, { once: true });

	let statusTimer: number | undefined;
	onAbort(() => window.clearTimeout(statusTimer));
	const showStatus = (message: string) => {
		window.clearTimeout(statusTimer);
		status.textContent = message;
		status.hidden = !message;
		if (message) statusTimer = window.setTimeout(() => { status.hidden = true; }, 6000);
	};

	if (!isChatConfigured) {
		empty.textContent = 'Chat is not available right now.';
		signIn.hidden = false;
		signIn.disabled = true;
		return;
	}

	let auth: OzAuth | undefined;
	let viewer: OzUser | null = null;
	let moderator = false;
	// The viewer's chat role from the CMS (any role moderates), for the badge on their own pending messages.
	let viewerRole: ChatRole | undefined;
	let slowMode = 0;

	// One actions menu is shared by all messages and moved next to whichever ⋯ button opened it.
	let menuTarget: { item: HTMLElement; button: HTMLButtonElement } | undefined;
	const closeMenu = (restoreFocus = false) => {
		if (!menuTarget) return;
		menu.hidden = true;
		menuTarget.button.setAttribute('aria-expanded', 'false');
		if (restoreFocus) menuTarget.button.focus();
		menuTarget = undefined;
	};

	const openMenu = (item: HTMLElement, button: HTMLButtonElement) => {
		const own = item.dataset.uid === viewer?.uid;
		const fromModerator = item.classList.contains('is-mod');
		const available: Record<ChatAction, boolean> = {
			report: Boolean(viewer) && !moderator && !own && !fromModerator,
			delete: moderator,
			timeout: moderator && !own && !fromModerator,
			ban: moderator && !own && !fromModerator,
		};
		menuActions.forEach((action) => { action.hidden = !available[action.dataset.chatAction as ChatAction]; });
		if (!menuActions.some((action) => !action.hidden)) return;

		menuTarget = { item, button };
		button.setAttribute('aria-expanded', 'true');
		menu.hidden = false;
		// Below the button, or above it when there is no room at the bottom of the chat.
		const container = menu.offsetParent ?? root;
		const bounds = container.getBoundingClientRect();
		const anchor = button.getBoundingClientRect();
		const below = anchor.bottom - bounds.top + 4;
		menu.style.top = `${below + menu.offsetHeight > bounds.height ? anchor.top - bounds.top - menu.offsetHeight - 4 : below}px`;
		menu.style.right = `${bounds.right - anchor.right}px`;
		menuActions.find((action) => !action.hidden)?.focus();
	};

	document.addEventListener('pointerdown', (event) => {
		if (menuTarget && event.target instanceof Node && !menu.contains(event.target) && !menuTarget.button.contains(event.target)) closeMenu();
	}, { signal });
	menu.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') closeMenu(true);
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		event.preventDefault();
		const visible = menuActions.filter((action) => !action.hidden);
		const index = visible.indexOf(document.activeElement as HTMLButtonElement);
		visible[(index + (event.key === 'ArrowDown' ? 1 : visible.length - 1)) % visible.length]?.focus();
	});

	// Who is looking decides the sign-in button vs. message box, own-message highlighting and the ⋯ buttons (see the styles).
	// Until a saved sign-in has been restored neither the button nor the box shows, so a signed-in visitor is never
	// asked to sign in again.
	let authKnown = false;
	const renderViewer = () => {
		closeMenu();
		signIn.hidden = !authKnown || Boolean(viewer);
		form.hidden = !viewer;
		if (account && accountName) {
			account.hidden = !viewer;
			accountName.textContent = viewer ? viewer.displayName || viewer.email || 'you' : '';
		}
		list.dataset.viewer = viewer ? (moderator ? 'mod' : 'member') : 'guest';
		for (const item of list.children) {
			if (item instanceof HTMLElement) item.classList.toggle('is-own', item.dataset.uid === viewer?.uid);
		}
		selfAvatar.replaceChildren(...(viewer ? [createAvatar(viewer.displayName || viewer.email || '?', viewer.photoURL)] : []));
		if (modControl) modControl.hidden = !moderator;
	};

	const renderMessage = (key: string, message: ChatMessage) => {
		const item = document.createElement('li');
		item.className = 'chat-message';
		item.dataset.key = key;
		item.dataset.uid = message.u;
		item.classList.toggle('is-own', message.u === viewer?.uid);
		item.classList.toggle('is-mod', Boolean(message.m));

		const meta = document.createElement('div');
		meta.className = 'chat-message-meta';
		const name = document.createElement('strong');
		name.textContent = message.n;
		meta.append(name);
		if (message.m) {
			// DEV, OPERATOR, HOST or MOD; messages from before roles, or from the other site, just say MOD.
			const role = isChatRole(message.r) ? message.r : 'mod';
			const badge = document.createElement('span');
			badge.className = 'chat-mod-badge';
			badge.dataset.role = role;
			badge.textContent = chatRoles[role];
			meta.append(badge);
		}
		if (typeof message.ts === 'number') {
			const time = document.createElement('time');
			time.dateTime = new Date(message.ts).toISOString();
			time.textContent = timeFormat.format(message.ts);
			meta.append(time);
		}

		const text = document.createElement('p');
		text.textContent = message.t;
		const body = document.createElement('div');
		body.className = 'chat-message-body';
		body.append(meta, text);

		// Opens the shared actions menu; hidden when the viewer has nothing to do with this message.
		const more = document.createElement('button');
		more.type = 'button';
		more.className = 'chat-message-more';
		more.dataset.chatMore = '';
		more.setAttribute('aria-label', `Options for ${message.n}'s message`);
		more.setAttribute('aria-haspopup', 'menu');
		more.setAttribute('aria-expanded', 'false');
		more.textContent = '⋯';

		item.append(createAvatar(message.n, message.p), body, more);
		return item;
	};

	// Stay pinned to the newest message unless the reader has scrolled up; then offer a jump button instead.
	let stickToBottom = true;
	let loaded = false;
	let layoutFrame: number | undefined;
	const scheduleLayout = (newMessage: boolean) => {
		if (newMessage && !stickToBottom) jump.hidden = false;
		if (layoutFrame !== undefined) return;
		layoutFrame = requestAnimationFrame(() => {
			layoutFrame = undefined;
			if (loaded) empty.hidden = list.childElementCount > 0;
			if (stickToBottom) list.scrollTop = list.scrollHeight;
		});
	};

	list.addEventListener('scroll', () => {
		closeMenu();
		stickToBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
		if (stickToBottom) jump.hidden = true;
	}, { passive: true });

	jump.addEventListener('click', () => {
		stickToBottom = true;
		jump.hidden = true;
		list.scrollTop = list.scrollHeight;
	});

	const database = getDatabase(getOzFirebaseApp());
	// Leaving the page lets the connection go (see below), so a later visit takes it back.
	goOnline(database);
	const messagesQuery = query(ref(database, `chat/rooms/${room}/messages`), orderByKey(), limitToLast(messageLimit));
	const items = new Map<string, HTMLLIElement>();
	// Sent messages show immediately; the placeholder is swapped for the real one when it arrives.
	const pending = new Map<string, HTMLLIElement>();
	const showLoadError = () => {
		empty.textContent = 'Chat could not be loaded. Please reload the page.';
		empty.hidden = false;
	};

	// The query is a sliding window: older messages are removed as new ones arrive, and a deleted message
	// is replaced by an older one, so each message is placed after the one the database says precedes it.
	const subscriptions = [onChildAdded(messagesQuery, (snapshot, previousKey) => {
		const message: unknown = snapshot.val();
		if (!snapshot.key || items.has(snapshot.key) || !isChatMessage(message)) return;
		const item = renderMessage(snapshot.key, message);
		items.set(snapshot.key, item);
		const previous = previousKey ? items.get(previousKey) : undefined;
		if (previous) previous.after(item);
		else if (previousKey === null) list.prepend(item);
		else list.append(item);
		pending.get(snapshot.key)?.remove();
		pending.delete(snapshot.key);
		scheduleLayout(loaded);
	}, showLoadError),

	onChildRemoved(messagesQuery, (snapshot) => {
		if (!snapshot.key) return;
		if (menuTarget?.item === items.get(snapshot.key)) closeMenu();
		items.get(snapshot.key)?.remove();
		items.delete(snapshot.key);
		scheduleLayout(false);
	}),

	// Shares the query's data with the listeners above, so it costs no extra download.
	onValue(messagesQuery, () => {
		loaded = true;
		empty.textContent = 'No messages yet. Say hi!';
		scheduleLayout(false);
	}, showLoadError, { onlyOnce: true }),

	onValue(ref(database, `chat/rooms/${room}/meta/slowMode`), (snapshot) => {
		const value: unknown = snapshot.val();
		slowMode = typeof value === 'number' ? value : 0;
		if (slowModeLabel) {
			slowModeLabel.hidden = !slowMode;
			slowModeLabel.textContent = `SLOW MODE · ${slowMode}S`;
		}
		if (slowModeSelect) slowModeSelect.value = String(slowMode);
	})];

	// Connections are the scarce resource (the free plan allows 100 at once), so idle viewers let theirs go.
	let chatInView = true;
	let offline = false;
	let idleTimer: number | undefined;
	const updateConnection = () => {
		if (chatInView && document.visibilityState === 'visible') {
			window.clearTimeout(idleTimer);
			idleTimer = undefined;
			if (offline) {
				goOnline(database);
				offline = false;
			}
		} else if (!offline && idleTimer === undefined) {
			idleTimer = window.setTimeout(() => {
				idleTimer = undefined;
				// Set first, so the disconnection below is counted as idle rather than a dropped network.
				offline = true;
				goOffline(database);
			}, idleDisconnectDelay);
		}
	};
	const viewObserver = new IntersectionObserver((entries) => {
		chatInView = entries[entries.length - 1]?.isIntersecting ?? chatInView;
		updateConnection();
	});
	viewObserver.observe(root);
	document.addEventListener('visibilitychange', updateConnection, { signal });

	// Connections and disconnections, for the chat analytics (src/lib/chat-events.ts).
	let connected = false;
	subscriptions.push(onValue(ref(database, '.info/connected'), (snapshot) => {
		const now = snapshot.val() === true;
		if (now === connected) return;
		connected = now;
		sendEvents([now
			? { type: 'chat_connection', room, state: 'connected' }
			: { type: 'chat_connection', room, state: 'disconnected', cause: offline ? 'idle' : 'network' }]);
	}));

	// Leaving the page stops the listeners and lets the connection go until the chat is shown again.
	onAbort(() => {
		subscriptions.forEach((unsubscribe) => unsubscribe());
		if (connected) sendEvents([{ type: 'chat_connection', room, state: 'disconnected', cause: 'leave' }]);
		viewObserver.disconnect();
		window.clearTimeout(idleTimer);
		if (layoutFrame !== undefined) cancelAnimationFrame(layoutFrame);
		goOffline(database);
	});

	const callApi = async (path: string, body: Record<string, unknown>) => {
		const [idToken, appCheckToken] = await Promise.all([auth?.idToken() ?? null, getAppCheckToken()]);
		if (!idToken) throw new Error('Please sign in to chat.');
		const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` };
		if (appCheckToken) headers['X-Firebase-AppCheck'] = appCheckToken;
		// `tab` (this page load) lets the dashboard count messages per visit.
		const response = await fetch(path, { method: 'POST', headers, body: JSON.stringify({ room, tab: tabId, ...body }) });
		const result = await response.json().catch(() => ({})) as { error?: string; hidden?: boolean; id?: string };
		if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.');
		return result;
	};

	let sending = false;
	let cooldownUntil = 0;
	let cooldownTimer: number | undefined;
	onAbort(() => window.clearTimeout(cooldownTimer));
	const updateSendButton = () => {
		window.clearTimeout(cooldownTimer);
		const remaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
		sendButton.disabled = sending || remaining > 0;
		sendButton.textContent = remaining > 0 ? `${remaining}s` : 'Send';
		if (remaining > 0) cooldownTimer = window.setTimeout(updateSendButton, 250);
	};

	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		const text = input.value.trim();
		if (!text || !viewer || sending || Date.now() < cooldownUntil) return;
		sending = true;
		if (!moderator) cooldownUntil = Date.now() + Math.max(minIntervalSeconds, slowMode) * 1000;
		updateSendButton();

		const placeholder = renderMessage('', {
			u: viewer.uid,
			n: viewer.displayName || 'You',
			p: viewer.photoURL ?? undefined,
			t: text,
			ts: Date.now(),
			m: moderator || undefined,
			r: viewerRole,
		});
		delete placeholder.dataset.key;
		placeholder.classList.add('is-pending');
		list.append(placeholder);
		empty.hidden = true;
		stickToBottom = true;
		scheduleLayout(false);
		input.value = '';
		showStatus('');

		try {
			const { id } = await callApi('/api/chat', { text });
			track('chat_message_send', { status: 'sent' });
			if (shownAt !== null) {
				sendEvents([{ type: 'chat_first_message', room, waitMs: performance.now() - shownAt }]);
				shownAt = null;
			}
			// The real message may already be here if the database was quicker than the response.
			if (id && !items.has(id)) pending.set(id, placeholder);
			else placeholder.remove();
		} catch (error) {
			track('chat_message_send', { status: 'failed' });
			// The server logs the messages it refuses; only those that never reached it are sent from here.
			if (error instanceof TypeError) sendEvents([{ type: 'chat_send_error', room, reason: 'network' }]);
			placeholder.remove();
			cooldownUntil = 0;
			if (!input.value) input.value = text;
			showStatus(errorMessage(error));
		} finally {
			sending = false;
			updateSendButton();
			input.focus();
		}
	});

	list.addEventListener('click', (event) => {
		const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-chat-more]') : null;
		const item = button?.closest<HTMLElement>('.chat-message');
		if (!button || !item?.dataset.key) return;
		const wasOpen = menuTarget?.button === button;
		closeMenu();
		if (!wasOpen) openMenu(item, button);
	});

	menu.addEventListener('click', async (event) => {
		const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-chat-action]') : null;
		const item = menuTarget?.item;
		const action = button?.dataset.chatAction as ChatAction | undefined;
		const id = item?.dataset.key;
		if (!button || !item || !action || !id) return;
		closeMenu(true);
		const name = item.querySelector('strong')?.textContent || 'this listener';
		const confirmation: Partial<Record<ChatAction, string>> = {
			report: 'Report this message to the moderators?',
			timeout: `Mute ${name} for ${timeoutMinutes} minutes?`,
			ban: `Ban ${name} from the chat? Their messages will be removed.`,
		};
		if (confirmation[action] && !window.confirm(confirmation[action])) return;

		try {
			if (action === 'report') {
				const { hidden } = await callApi('/api/chat', { action, id });
				showStatus(hidden ? 'Thanks. The message has been hidden.' : 'Thanks. A moderator will take a look.');
			} else {
				await callApi('/api/chat-mod', { action, id, minutes: timeoutMinutes });
				if (action === 'timeout') showStatus(`${name} is muted for ${timeoutMinutes} minutes.`);
				if (action === 'ban') showStatus(`${name} has been banned.`);
			}
		} catch (error) {
			showStatus(errorMessage(error));
		}
	});

	slowModeSelect?.addEventListener('change', async () => {
		const previous = slowMode;
		try {
			await callApi('/api/chat-mod', { action: 'slowmode', seconds: Number(slowModeSelect.value) });
		} catch (error) {
			slowModeSelect.value = String(previous);
			showStatus(errorMessage(error));
		}
	});

	signIn.addEventListener('click', async () => {
		if (!auth) return;
		signIn.disabled = true;
		track('chat_sign_in', { status: 'attempt' });
		sendEvents([{ type: 'chat_sign_in', room, status: 'attempt' }]);
		try {
			const { isNewUser } = await auth.signIn();
			// GA4's own events for a sign-in, and for a first one.
			track('login', { method: 'Google' });
			if (isNewUser) track('sign_up', { method: 'Google' });
			sendEvents([{ type: 'chat_sign_in', room, status: 'success', newAccount: isNewUser }]);
		} catch (error) {
			const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
			const cancelled = code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request';
			track('chat_sign_in', { status: cancelled ? 'cancelled' : 'failed', error_code: typeof code === 'string' ? code : 'unknown' });
			sendEvents([{ type: 'chat_sign_in', room, status: cancelled ? 'cancelled' : 'failed', code: typeof code === 'string' ? code.replace(/^auth\//, '') : 'unknown' }]);
			if (!cancelled) {
				console.warn('Google sign-in failed:', error);
				showStatus(code === 'auth/popup-blocked'
					? 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.'
					: code === 'auth/unauthorized-domain'
						? 'Google sign-in is not enabled on this address yet.'
						: 'Google sign-in failed. Please try again.');
			}
		} finally {
			signIn.disabled = false;
		}
	});

	signOut?.addEventListener('click', () => {
		track('chat_sign_out');
		void auth?.signOut();
	});

	// From the chat being shown to this page view's first message; null once sent.
	let shownAt: number | null = performance.now();

	renderViewer();
	auth = await loadAuth();
	if (signal.aborted) return;
	if (!auth) {
		authKnown = true;
		sendEvents([{ type: 'chat_view', room, signedIn: false }]);
		renderViewer();
		signIn.disabled = true;
		showStatus('Google sign-in is unavailable right now. Please try again later.');
		return;
	}
	const currentAuth = auth;
	// Firebase keeps the sign-in on this device until the visitor signs out; wait for it to be restored.
	const restored = await currentAuth.ready().catch(() => null);
	if (signal.aborted) return;
	authKnown = true;
	// Once per page view, once it's known whether the viewer is signed in. A view is not a person.
	sendEvents([{ type: 'chat_view', room, signedIn: Boolean(restored) }]);
	onAbort(currentAuth.onChange(async (user) => {
		viewer = user;
		moderator = false;
		viewerRole = undefined;
		renderViewer();
		if (!user) return;
		// The role is set in the CMS, so the server looks it up; a failed lookup just means no moderation tools.
		const { role } = await callApi('/api/chat-role', {}).catch(() => ({ role: null })) as { role?: unknown };
		// Ignore the answer if the account changed while it was loading.
		if (viewer !== user || !isChatRole(role)) return;
		moderator = true;
		viewerRole = role;
		renderViewer();
	}));
};
