// video.js ships a "core" build without its HLS/DASH engine (VHS) but no types for it.
// It exposes the same API as the full build, so it reuses the full build's types.
declare module 'video.js/core.es.js' {
	import videojs from 'video.js';
	export default videojs;
}
