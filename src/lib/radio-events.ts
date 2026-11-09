// Radio listening events, sent by the browser (src/scripts/oz-radio-tracker.ts) to /api/track and stored on our own
// server (src/lib/event-store.ts). Shared by both sides, so they agree on what is valid.
//
// A listening session runs from the moment sound starts until it stops: a pause, the stop button, switching stream,
// an error the player couldn't recover from, the listener form taking over, or the page being closed.

export const streamTypes = ['audio', 'video'] as const;
export type StreamType = (typeof streamTypes)[number];

/** Where the play came from: the tune-in dialog, the player on the station page, or the mini player on OZ News. */
export const playSources = ['tune_in', 'station_page', 'mini_player'] as const;
export type PlaySource = (typeof playSources)[number];

export const endReasons = ['pause', 'stop', 'switch', 'error', 'listener_form', 'page_close'] as const;
export type EndReason = (typeof endReasons)[number];

/** Buffering: the stream stalled and caught up again. Reconnect: the connection dropped and the player re-opened it. */
export const interruptionKinds = ['buffering', 'reconnect'] as const;
export type InterruptionKind = (typeof interruptionKinds)[number];

export type RadioEvent =
	| { type: 'play_click'; stream: StreamType; source: PlaySource }
	| { type: 'stream_start'; sid: string; stream: StreamType; source: PlaySource; waitMs?: number }
	| { type: 'heartbeat'; sid: string; stream: StreamType; listenedMs: number }
	| { type: 'stream_end'; sid: string; stream: StreamType; listenedMs: number; reason: EndReason }
	| { type: 'interruption'; sid: string; stream: StreamType; kind: InterruptionKind }
	| { type: 'stream_error'; sid?: string; stream: StreamType; code: string };

/** Sent with every batch: a random per-visit id, and a lasting listener id only for visitors who accepted analytics cookies. */
export type RadioBatch = { tab: string; vid?: string; events: RadioEvent[] };

/** The browser checks in this often while sound plays, so a closed tab still leaves an accurate duration. */
export const heartbeatInterval = 60_000;
