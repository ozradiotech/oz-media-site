// The OZ audio player: Video.js drives the live stream, with custom components for the
// track metadata, the live indicator, and a waveform visualizer (added by the ozWaveform plugin).
// The core build leaves out Video.js's HLS/DASH engine, which an Icecast stream doesn't need.
// Swap to the full 'video.js' import once the player also handles HLS video livestreams.
import videojs from 'video.js/core.es.js';
import type Player from 'video.js/dist/types/player';
import '../styles/oz-audio-player.css';

type PlayerState = 'idle' | 'connecting' | 'live' | 'error';

const Component = videojs.getComponent('Component');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

class OzTrackInfo extends Component {
	private readonly text: HTMLElement;
	private readonly title: HTMLElement;
	private readonly titleText: HTMLElement;
	private readonly artist: HTMLElement;
	private readonly resizeObserver: ResizeObserver;
	private currentTrack = '';
	private swapTimer: number | undefined;

	constructor(player: Player, options?: Record<string, unknown>) {
		super(player, options);
		const label = document.createElement('span');
		label.className = 'oz-track-label';
		label.textContent = 'NOW PLAYING';
		this.text = document.createElement('div');
		this.text.className = 'oz-track-text';
		this.title = document.createElement('strong');
		this.title.className = 'oz-track-title';
		this.titleText = document.createElement('span');
		this.titleText.className = 'oz-track-title-text';
		this.artist = document.createElement('span');
		this.artist.className = 'oz-track-artist';
		this.title.append(this.titleText);
		this.text.append(this.title, this.artist);
		this.el().append(label, this.text);
		this.resizeObserver = new ResizeObserver(() => this.updateMarquee());
		this.resizeObserver.observe(this.title);
	}

	createEl() {
		return super.createEl('div', { className: 'oz-track-info' }, { 'aria-live': 'polite' });
	}

	setTrack(title: string, artist: string) {
		const track = `${title}\n${artist}`;
		if (track === this.currentTrack) return;
		const isFirstTrack = !this.currentTrack;
		this.currentTrack = track;
		window.clearTimeout(this.swapTimer);

		const swap = () => {
			this.titleText.textContent = title;
			this.title.title = title;
			this.artist.textContent = artist;
			this.el().classList.remove('is-changing');
			this.updateMarquee();
		};
		if (isFirstTrack || reducedMotion.matches) {
			swap();
			return;
		}
		// Fade the old track out before the new one slides in.
		this.el().classList.add('is-changing');
		this.swapTimer = window.setTimeout(swap, 200);
	}

	// Titles too long for the player scroll back and forth instead of being cut off.
	private updateMarquee() {
		const overflow = this.titleText.scrollWidth - this.title.clientWidth;
		const shouldScroll = overflow > 2 && !reducedMotion.matches;
		this.title.classList.toggle('is-marquee', shouldScroll);
		if (!shouldScroll) return;
		const distance = overflow + 24;
		this.title.style.setProperty('--oz-marquee-distance', `${-distance}px`);
		this.title.style.setProperty('--oz-marquee-duration', `${Math.max(6, distance / 22)}s`);
	}

	dispose() {
		window.clearTimeout(this.swapTimer);
		this.resizeObserver.disconnect();
		super.dispose();
	}
}

const stateLabels: Record<PlayerState, string> = {
	idle: 'LIVE',
	connecting: 'CONNECTING',
	live: 'LIVE',
	error: 'OFFLINE',
};

class OzLiveBadge extends Component {
	private readonly label: HTMLElement;

	constructor(player: Player, options?: Record<string, unknown>) {
		super(player, options);
		const dot = document.createElement('span');
		dot.className = 'oz-live-dot';
		dot.setAttribute('aria-hidden', 'true');
		this.label = document.createElement('span');
		this.label.className = 'oz-live-label';
		this.el().append(dot, this.label);
		this.showState('idle');
	}

	createEl() {
		return super.createEl('div', { className: 'oz-live-badge' }, { role: 'status' });
	}

	// Driven by createOzAudioPlayer, which can tell a listener pausing from the stream dropping.
	// The player's root carries the state too, so the theme can restyle every part from it.
	showState(state: PlayerState) {
		this.label.textContent = stateLabels[state];
		this.player().el().setAttribute('data-oz-state', state);
	}
}

type Rgb = [number, number, number];

const parseHexColor = (value: string, fallback: Rgb): Rgb => {
	const match = /^#([\da-f]{6})$/i.exec(value.trim());
	if (!match) return fallback;
	const hex = Number.parseInt(match[1], 16);
	return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
};

const BAR_WIDTH = 3;
const BAR_GAP = 3;
const MAX_BARS = 96;
const REDUCED_MOTION_FRAME_MS = 120;

// Bars mirror outwards from the centre: bass in the middle, treble at both edges.
class OzWaveform extends Component {
	private readonly canvas: HTMLCanvasElement;
	private readonly context: CanvasRenderingContext2D | null;
	private readonly resizeObserver: ResizeObserver;
	private readonly intersectionObserver: IntersectionObserver;
	private audioContext: AudioContext | undefined;
	private analyser: AnalyserNode | undefined;
	private frequencies: Uint8Array<ArrayBuffer> | undefined;
	private binEdges: Uint16Array = new Uint16Array(0);
	private levels: Float32Array = new Float32Array(0);
	private activeMix = 0;
	private isActive = false;
	private isVisible = false;
	private frameRequest = 0;
	private lastFrame = 0;
	private idleColor: Rgb = [216, 216, 204];
	private accentColor: Rgb = [242, 189, 87];
	private tipColor: Rgb = [248, 217, 156];

	constructor(player: Player, options?: Record<string, unknown>) {
		super(player, options);
		this.canvas = document.createElement('canvas');
		this.canvas.setAttribute('aria-hidden', 'true');
		this.el().append(this.canvas);
		this.context = this.canvas.getContext('2d');

		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(this.el());
		this.intersectionObserver = new IntersectionObserver(([entry]) => {
			this.isVisible = entry?.isIntersecting ?? false;
			this.requestFrame();
		});
		this.intersectionObserver.observe(this.el());
		document.addEventListener('visibilitychange', this.requestFrame);

		// Browsers only start audio processing from a user gesture, so the audio graph is set up then.
		player.el().addEventListener('pointerdown', this.prime);
		player.el().addEventListener('keydown', this.prime);
		player.on('play', () => {
			if (this.audioContext?.state === 'suspended') void this.audioContext.resume().catch(() => {});
		});
		player.on('playing', () => {
			this.connectAudio();
			this.isActive = true;
			this.requestFrame();
		});
		player.on(['pause', 'waiting', 'error', 'emptied'], () => {
			this.isActive = false;
			this.requestFrame();
		});
	}

	createEl() {
		return super.createEl('div', { className: 'oz-waveform' });
	}

	prime = () => {
		if (!this.audioContext) {
			const AudioContextClass = window.AudioContext
				?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
			if (!AudioContextClass) return;
			this.audioContext = new AudioContextClass();
		}
		if (this.audioContext.state === 'running') {
			this.connectAudio();
			return;
		}
		void this.audioContext.resume().then(() => this.connectAudio()).catch(() => {});
	};

	// Routes the stream through an analyser. This only happens once the audio context is running:
	// media routed into a suspended context would go silent. Until then the bars animate on their own.
	private connectAudio() {
		if (this.analyser || this.audioContext?.state !== 'running') return;
		const media = this.player().tech(true)?.el();
		if (!(media instanceof HTMLMediaElement)) return;
		try {
			const source = this.audioContext.createMediaElementSource(media);
			const analyser = this.audioContext.createAnalyser();
			analyser.fftSize = 512;
			analyser.smoothingTimeConstant = 0.72;
			analyser.minDecibels = -88;
			analyser.maxDecibels = -22;
			source.connect(analyser);
			analyser.connect(this.audioContext.destination);
			this.analyser = analyser;
			this.frequencies = new Uint8Array(analyser.frequencyBinCount);
			this.updateBinEdges();
		} catch {
			this.analyser = undefined;
		}
	}

	// Spreads the bars logarithmically from ~60 Hz to ~14 kHz, the way we hear pitch.
	private updateBinEdges() {
		const half = this.levels.length / 2;
		if (!this.analyser || !this.audioContext || !half) return;
		const binHz = this.audioContext.sampleRate / this.analyser.fftSize;
		const minBin = Math.max(1, Math.round(60 / binHz));
		const maxBin = Math.min(this.analyser.frequencyBinCount - 1, Math.round(14_000 / binHz));
		this.binEdges = new Uint16Array(half + 1);
		for (let index = 0; index <= half; index += 1) {
			const edge = Math.round(minBin * (maxBin / minBin) ** (index / half));
			this.binEdges[index] = index ? Math.max(edge, this.binEdges[index - 1] + 1) : edge;
		}
	}

	private resize() {
		const width = this.el().clientWidth;
		const height = this.el().clientHeight;
		const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
		this.canvas.width = Math.max(1, Math.round(width * pixelRatio));
		this.canvas.height = Math.max(1, Math.round(height * pixelRatio));

		const fit = Math.floor((width + BAR_GAP) / (BAR_WIDTH + BAR_GAP));
		const barCount = Math.max(8, Math.min(MAX_BARS, fit - (fit % 2)));
		if (barCount !== this.levels.length) {
			this.levels = new Float32Array(barCount);
			this.updateBinEdges();
		}

		const styles = getComputedStyle(this.el());
		this.idleColor = parseHexColor(styles.getPropertyValue('--oz-line'), this.idleColor);
		this.accentColor = parseHexColor(styles.getPropertyValue('--oz-accent'), this.accentColor);
		this.tipColor = parseHexColor(styles.getPropertyValue('--oz-wave-tip'), this.tipColor);
		this.draw();
		this.requestFrame();
	}

	private requestFrame = () => {
		if (this.frameRequest || !this.isVisible || document.hidden || !this.context) return;
		this.frameRequest = window.requestAnimationFrame(this.frame);
	};

	private frame = (now: number) => {
		this.frameRequest = 0;
		if (reducedMotion.matches && now - this.lastFrame < REDUCED_MOTION_FRAME_MS) {
			this.requestFrame();
			return;
		}
		this.lastFrame = now;

		const half = this.levels.length / 2;
		const hasAnalyser = this.isActive && this.analyser && this.frequencies && this.binEdges.length === half + 1;
		if (hasAnalyser) this.analyser!.getByteFrequencyData(this.frequencies!);

		let isMoving = false;
		for (let index = 0; index < half; index += 1) {
			let target = 0;
			if (hasAnalyser) {
				let peak = 0;
				for (let bin = this.binEdges[index]; bin < this.binEdges[index + 1]; bin += 1) {
					peak = Math.max(peak, this.frequencies![bin]);
				}
				// Treble carries less energy, so it gets a lift to keep the outer bars moving.
				target = Math.min(1, (peak / 255) ** 1.6 * (1 + (index / half) * 0.7));
			} else if (this.isActive) {
				// No analyser available (e.g. audio processing blocked): a gentle synthetic motion.
				const wave = Math.sin(now / 420 + index * 0.6) * Math.sin(now / 1130 + index * 0.23);
				target = 0.18 + Math.abs(wave) * 0.42 * (1 - (index / half) * 0.5);
			}
			const level = this.levels[index];
			// Bars rise quickly and fall slowly, like a VU meter.
			const next = level + (target - level) * (target > level ? 0.5 : 0.14);
			this.levels[index] = next < 0.002 ? 0 : next;
			if (this.levels[index] > 0) isMoving = true;
		}

		const targetMix = this.isActive ? 1 : 0;
		this.activeMix += (targetMix - this.activeMix) * 0.12;
		if (Math.abs(targetMix - this.activeMix) < 0.01) this.activeMix = targetMix;
		else isMoving = true;

		this.draw();
		// Stop the loop once playback stops and the bars have settled, so an idle player costs nothing.
		if (this.isActive || isMoving) this.requestFrame();
	};

	private draw() {
		const context = this.context;
		if (!context) return;
		const { width, height } = this.canvas;
		const barCount = this.levels.length;
		const half = barCount / 2;
		context.clearRect(0, 0, width, height);
		if (!barCount || width < 2 || height < 2) return;

		const pixelRatio = width / Math.max(1, this.el().clientWidth);
		const step = width / barCount;
		const barWidth = Math.max(1, Math.min(step * 0.56, 6 * pixelRatio));
		const restHeight = Math.max(barWidth, 3 * pixelRatio);
		const middle = height / 2;

		context.beginPath();
		for (let bar = 0; bar < barCount; bar += 1) {
			const level = this.levels[bar < half ? half - 1 - bar : bar - half];
			const barHeight = restHeight + level * (height - restHeight);
			const x = bar * step + (step - barWidth) / 2;
			if (context.roundRect) context.roundRect(x, middle - barHeight / 2, barWidth, barHeight, barWidth / 2);
			else context.rect(x, middle - barHeight / 2, barWidth, barHeight);
		}

		// Grey at rest, crossfading to the amber accent (lighter at the tips) while live.
		const [idleRed, idleGreen, idleBlue] = this.idleColor;
		context.fillStyle = `rgb(${idleRed} ${idleGreen} ${idleBlue})`;
		context.fill();
		if (this.activeMix > 0) {
			const gradient = context.createLinearGradient(0, 0, 0, height);
			const tip = `rgb(${this.tipColor.join(' ')})`;
			const accent = `rgb(${this.accentColor.join(' ')})`;
			gradient.addColorStop(0, tip);
			gradient.addColorStop(0.5, accent);
			gradient.addColorStop(1, tip);
			context.globalAlpha = this.activeMix;
			context.fillStyle = gradient;
			context.fill();
			context.globalAlpha = 1;
		}
	}

	dispose() {
		window.cancelAnimationFrame(this.frameRequest);
		this.resizeObserver.disconnect();
		this.intersectionObserver.disconnect();
		document.removeEventListener('visibilitychange', this.requestFrame);
		this.player().el().removeEventListener('pointerdown', this.prime);
		this.player().el().removeEventListener('keydown', this.prime);
		void this.audioContext?.close().catch(() => {});
		super.dispose();
	}
}

videojs.registerComponent('OzTrackInfo', OzTrackInfo);
videojs.registerComponent('OzLiveBadge', OzLiveBadge);
videojs.registerComponent('OzWaveform', OzWaveform);

// Video.js plugin: adds the waveform visualizer to a player. Returns the component.
videojs.registerPlugin('ozWaveform', function (this: Player, options?: Record<string, unknown>) {
	return this.addChild('OzWaveform', options) as OzWaveform;
});

export type OzAudioPlayer = {
	play: () => void;
	pause: () => void;
	setTrack: (title: string, artist: string) => void;
};

const MAX_RECONNECT_ATTEMPTS = 3;

// Upgrades an <audio> element into the OZ player. Its native events keep firing, so listeners
// attached to the element before the upgrade continue to work.
export const createOzAudioPlayer = (media: HTMLAudioElement, streamUrl: string): OzAudioPlayer => {
	// The stream is served with CORS headers, which the waveform's audio analysis needs.
	media.crossOrigin = 'anonymous';
	// Video.js carries the tag's classes over to the player it builds.
	media.classList.add('video-js', 'vjs-oz');
	const source = { src: streamUrl, type: 'audio/aac' };
	const player = videojs(media, {
		controls: true,
		preload: 'none',
		inactivityTimeout: 0,
		experimentalSvgIcons: true,
		sources: [source],
		children: ['mediaLoader', 'ozTrackInfo', 'controlBar'],
		controlBar: {
			children: ['playToggle', 'volumePanel', 'ozLiveBadge'],
			volumePanel: { inline: true },
		},
	});
	const waveform = (player as Player & { ozWaveform: () => OzWaveform }).ozWaveform();
	const trackInfo = player.getChild('OzTrackInfo') as OzTrackInfo | undefined;
	const liveBadge = player.getChild('ControlBar')?.getChild('OzLiveBadge') as OzLiveBadge | undefined;
	const showState = (state: PlayerState) => liveBadge?.showState(state);

	let wantsPlayback = false;
	let isOffline = false;
	let reconnectAttempts = 0;
	let reconnectTimer: number | undefined;

	// Reloading the source drops the connection, so nothing downloads in the background
	// and the next play starts at the live edge instead of where the listener paused.
	const reload = () => {
		player.error(null);
		player.src(source);
	};

	const reconnect = () => {
		window.clearTimeout(reconnectTimer);
		if (!wantsPlayback || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
			wantsPlayback = false;
			// Reset the stream so the play button can try again. An unsupported format
			// would fail the same way again, so it isn't reloaded.
			if (player.error()?.code !== MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) reload();
			isOffline = true;
			showState('error');
			return;
		}
		reconnectAttempts += 1;
		// A recoverable error never shows as offline.
		showState('connecting');
		// The stream sometimes fails on its very first packet, which an immediate retry fixes.
		// Later retries back off in case the station is actually down.
		const delay = reconnectAttempts === 1 ? 250 : 2000 * (reconnectAttempts - 1);
		reconnectTimer = window.setTimeout(() => {
			reload();
			void player.play()?.catch(() => {});
		}, delay);
	};

	player.on('play', () => {
		wantsPlayback = true;
		isOffline = false;
		showState('connecting');
	});
	player.on('waiting', () => {
		if (wantsPlayback) showState('connecting');
	});
	player.on('playing', () => {
		reconnectAttempts = 0;
		showState('live');
	});
	player.on('pause', () => {
		// Browsers also pause when the stream errors or ends; the reconnect logic handles those.
		if (player.ended() || player.error() || isOffline) return;
		showState('idle');
		wantsPlayback = false;
		window.clearTimeout(reconnectTimer);
		reload();
	});
	// A live stream "ends" when the connection drops; try to get it back.
	player.on(['ended', 'error'], reconnect);

	return {
		play: () => {
			waveform.prime();
			void player.play()?.catch(() => {});
		},
		pause: () => {
			player.pause();
		},
		setTrack: (title, artist) => {
			trackInfo?.setTrack(title, artist);
		},
	};
};
