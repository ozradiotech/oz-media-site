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
// The sun visualizer: rays roughly this many pixels apart, and one full turn every 90 seconds while live.
const RAY_SPACING = 10;
const SUN_TURN_MS = 90_000;

export type OzVisualizer = 'bars' | 'sun';

// 'bars' mirror outwards from the centre: bass in the middle, treble at both edges.
// 'sun' radiates rays around a sliced sun disk: bass at the top, treble at the bottom, mirrored left and right.
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
	private sunColor: Rgb = [242, 189, 87];
	private readonly shape: OzVisualizer;
	private rotation = 0;

	constructor(player: Player, options?: Record<string, unknown>) {
		super(player, options);
		this.shape = options?.shape === 'sun' ? 'sun' : 'bars';
		this.el().classList.add(`oz-waveform-${this.shape}`);
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

		let barCount: number;
		if (this.shape === 'sun') {
			const rays = Math.round((Math.PI * Math.min(width, height) * 0.67) / RAY_SPACING);
			barCount = Math.max(24, Math.min(MAX_BARS, rays - (rays % 2)));
		} else {
			const fit = Math.floor((width + BAR_GAP) / (BAR_WIDTH + BAR_GAP));
			barCount = Math.max(8, Math.min(MAX_BARS, fit - (fit % 2)));
		}
		if (barCount !== this.levels.length) {
			this.levels = new Float32Array(barCount);
			this.updateBinEdges();
		}

		const styles = getComputedStyle(this.el());
		this.idleColor = parseHexColor(styles.getPropertyValue('--oz-line'), this.idleColor);
		this.accentColor = parseHexColor(styles.getPropertyValue('--oz-accent'), this.accentColor);
		this.tipColor = parseHexColor(styles.getPropertyValue('--oz-wave-tip'), this.tipColor);
		this.sunColor = parseHexColor(styles.getPropertyValue('--oz-sun'), this.accentColor);
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
		// The sun turns slowly while live; the step is capped so a frame after a long pause doesn't jump.
		if (this.shape === 'sun' && this.isActive && !reducedMotion.matches && this.lastFrame) {
			const step = (Math.min(now - this.lastFrame, 64) / SUN_TURN_MS) * Math.PI * 2;
			this.rotation = (this.rotation + step) % (Math.PI * 2);
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
		if (this.shape === 'sun') this.drawSun();
		else this.drawBars();
	}

	private drawBars() {
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

	private drawSun() {
		const context = this.context;
		if (!context) return;
		const { width, height } = this.canvas;
		const rayCount = this.levels.length;
		const half = rayCount / 2;
		context.clearRect(0, 0, width, height);
		if (!rayCount || width < 2 || height < 2) return;

		const pixelRatio = width / Math.max(1, this.el().clientWidth);
		const size = Math.min(width, height);
		const centerX = width / 2;
		const centerY = height / 2;
		// The lowest bands swell the disk a little, like the sun breathing with the bass.
		const bass = (this.levels[0] + this.levels[1] + this.levels[2]) / 3;
		const sunRadius = size * 0.29 * (1 + bass * 0.045 * this.activeMix);
		const rayStart = size * 0.335;
		const rayReach = size * 0.5 - rayStart - 3 * pixelRatio;
		const restLength = Math.max(3 * pixelRatio, rayReach * 0.1);
		const rayWidth = Math.max(1.5 * pixelRatio, ((Math.PI * 2 * rayStart) / rayCount) * 0.42);

		// Sun disk, with the 70s horizontal slices cut through its lower half, widening towards the bottom.
		context.fillStyle = `rgb(${this.sunColor.join(' ')})`;
		context.beginPath();
		context.arc(centerX, centerY, sunRadius, 0, Math.PI * 2);
		context.fill();
		context.globalCompositeOperation = 'destination-out';
		for (let slice = 0; slice < 5; slice += 1) {
			const y = centerY + sunRadius * (0.2 + slice * 0.16);
			context.fillRect(centerX - sunRadius, y, sunRadius * 2, sunRadius * (0.03 + slice * 0.018));
		}
		context.globalCompositeOperation = 'source-over';

		context.save();
		context.translate(centerX, centerY);
		context.rotate(this.rotation);
		context.lineCap = 'round';
		context.lineWidth = rayWidth;
		context.beginPath();
		for (let ray = 0; ray < rayCount; ray += 1) {
			const level = this.levels[Math.min(half - 1, Math.min(ray, rayCount - ray))];
			const length = restLength + level * (rayReach - restLength);
			const angle = (ray / rayCount) * Math.PI * 2 - Math.PI / 2;
			const cos = Math.cos(angle);
			const sin = Math.sin(angle);
			context.moveTo(cos * rayStart, sin * rayStart);
			context.lineTo(cos * (rayStart + length), sin * (rayStart + length));
		}

		// Muted at rest, crossfading to sun-coloured rays (lighter at the tips) while live.
		context.strokeStyle = `rgb(${this.idleColor.join(' ')})`;
		context.stroke();
		if (this.activeMix > 0) {
			const gradient = context.createRadialGradient(0, 0, rayStart, 0, 0, rayStart + rayReach);
			gradient.addColorStop(0, `rgb(${this.accentColor.join(' ')})`);
			gradient.addColorStop(1, `rgb(${this.tipColor.join(' ')})`);
			context.globalAlpha = this.activeMix;
			context.strokeStyle = gradient;
			context.stroke();
			context.globalAlpha = 1;
		}
		context.restore();
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

export type OzAudioPlayerOptions = {
	// The visualizer's shape. A station theme class (e.g. 'vjs-oz-bali') restyles the rest of the player.
	visualizer?: OzVisualizer;
	className?: string;
};

// Upgrades an <audio> element into the OZ player. Its native events keep firing, so listeners
// attached to the element before the upgrade continue to work.
export const createOzAudioPlayer = (
	media: HTMLAudioElement,
	streamUrl: string,
	{ visualizer = 'bars', className }: OzAudioPlayerOptions = {},
): OzAudioPlayer => {
	// The stream is served with CORS headers, which the waveform's audio analysis needs.
	media.crossOrigin = 'anonymous';
	// Video.js carries the tag's classes over to the player it builds.
	media.classList.add('video-js', 'vjs-oz');
	if (className) media.classList.add(className);
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
	const waveform = (player as Player & { ozWaveform: (options: Record<string, unknown>) => OzWaveform })
		.ozWaveform({ shape: visualizer });
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
