// Location suggestions for the listener form. Indonesian cities and regencies come from a bundled list
// (src/data/indonesia-locations.json), so "bandung" offers "Kota Bandung, Jawa Barat, Indonesia" straight away.
// Places elsewhere come from Photon (https://photon.komoot.io), an OpenStreetMap search that allows typeahead use.
// Typed text is always accepted as-is: the suggestions only help listeners fill it in consistently.

type Locations = { provinces: string[]; regencies: [name: string, province: number][] };

type Suggestion = { label: string; key: string };

type PhotonResponse = {
	features?: { properties?: { osm_key?: string; osm_value?: string; name?: string; county?: string; state?: string; country?: string; countrycode?: string } }[];
};

const MAX_LOCAL = 6;
const MAX_TOTAL = 8;
const REMOTE_MIN_LENGTH = 3;
const REMOTE_DELAY = 300;
const settlementTypes = new Set(['city', 'town', 'village', 'municipality', 'borough', 'suburb', 'county', 'district', 'province', 'state', 'region']);

const normalize = (value: string) => value
	.toLowerCase()
	.normalize('NFD')
	.replace(/\p{M}/gu, '')
	.replace(/[^a-z0-9]+/g, ' ')
	.trim();

const withoutRegencyType = (value: string) => value.replace(/^(kota|kabupaten|kab|kabupaten adm|kota adm) /, '');

// Everyday names for places whose official name differs.
const nicknames: Record<string, string> = {
	solo: 'surakarta',
	jogja: 'yogyakarta',
	jogjakarta: 'yogyakarta',
};

let localRequest: Promise<{ label: string; search: string; bare: string; isCity: boolean }[]> | undefined;

const loadLocal = () => {
	localRequest ??= import('../data/indonesia-locations.json').then(({ default: data }) => {
		const { provinces, regencies } = data as Locations;
		return regencies.map(([name, province]) => {
			const search = normalize(name);
			return {
				label: `${name}, ${provinces[province]}, Indonesia`,
				search,
				bare: withoutRegencyType(search),
				isCity: search.startsWith('kota '),
			};
		});
	});
	return localRequest;
};

const findLocal = async (query: string): Promise<Suggestion[]> => {
	const typed = withoutRegencyType(normalize(query));
	if (!typed) return [];
	const term = nicknames[typed] ?? typed;
	const locations = await loadLocal();
	const rank = (location: Awaited<ReturnType<typeof loadLocal>>[number]) => {
		if (location.bare === term) return 0;
		if (location.bare.startsWith(term)) return 1;
		if (location.bare.split(' ').some((word) => word.startsWith(term))) return 2;
		if (normalize(location.label).includes(term)) return 3;
		return -1;
	};
	return locations
		.map((location) => ({ location, rank: rank(location) }))
		.filter(({ rank }) => rank >= 0)
		// Cities before regencies of the same name: Kota Bandung, then Kabupaten Bandung.
		.sort((a, b) => a.rank - b.rank || Number(b.location.isCity) - Number(a.location.isCity) || a.location.bare.localeCompare(b.location.bare))
		.slice(0, MAX_LOCAL)
		.map(({ location }) => ({ label: location.label, key: normalize(location.label) }));
};

const findRemote = async (query: string, signal: AbortSignal, skipIndonesia: boolean): Promise<Suggestion[]> => {
	const url = new URL('https://photon.komoot.io/api/');
	url.searchParams.set('q', query);
	url.searchParams.set('limit', '10');
	url.searchParams.set('lang', 'en');
	url.searchParams.set('osm_tag', 'place');
	const response = await fetch(url, { signal });
	if (!response.ok) return [];
	const data = (await response.json()) as PhotonResponse;
	const suggestions: Suggestion[] = [];
	for (const feature of data.features ?? []) {
		const place = feature.properties;
		// Only settlements and regions: skips the islands, hamlets and squares OpenStreetMap also tags as places.
		if (!place?.name || !place.country || place.osm_key !== 'place' || !settlementTypes.has(place.osm_value ?? '')) continue;
		if (skipIndonesia && place.countrycode === 'ID') continue;
		const parts = [place.name, place.state ?? place.county, place.country].filter((part, index, all): part is string => Boolean(part) && all.indexOf(part) === index);
		const label = parts.join(', ');
		suggestions.push({ label, key: normalize(label) });
	}
	return suggestions;
};

export const mountLocationAutocomplete = (input: HTMLInputElement, list: HTMLElement) => {
	let suggestions: Suggestion[] = [];
	let active = -1;
	let remoteTimer: number | undefined;
	let remoteController: AbortController | undefined;
	let generation = 0;

	const render = () => {
		list.replaceChildren(...suggestions.map((suggestion, index) => {
			const option = document.createElement('li');
			option.id = `${list.id}-${index}`;
			option.setAttribute('role', 'option');
			option.textContent = suggestion.label;
			option.setAttribute('aria-selected', String(index === active));
			return option;
		}));
		const open = suggestions.length > 0 && document.activeElement === input;
		list.hidden = !open;
		input.setAttribute('aria-expanded', String(open));
		if (open && active >= 0) {
			input.setAttribute('aria-activedescendant', `${list.id}-${active}`);
			list.children[active]?.scrollIntoView({ block: 'nearest' });
		} else {
			input.removeAttribute('aria-activedescendant');
		}
	};

	const close = () => {
		window.clearTimeout(remoteTimer);
		remoteController?.abort();
		generation += 1;
		suggestions = [];
		active = -1;
		render();
	};

	const choose = (index: number) => {
		const suggestion = suggestions[index];
		if (!suggestion) return;
		input.value = suggestion.label;
		close();
	};

	const update = async () => {
		const query = input.value.trim();
		const current = ++generation;
		window.clearTimeout(remoteTimer);
		remoteController?.abort();
		if (!query) {
			close();
			return;
		}

		const local = await findLocal(query).catch(() => []);
		if (current !== generation) return;
		suggestions = local;
		active = -1;
		render();

		if (query.length < REMOTE_MIN_LENGTH) return;
		remoteTimer = window.setTimeout(async () => {
			remoteController = new AbortController();
			// The bundled list already names Indonesian cities the way listeners expect.
			const remote = await findRemote(query, remoteController.signal, local.length > 0).catch(() => []);
			if (current !== generation) return;
			const seen = new Set(local.map((suggestion) => suggestion.key));
			const extra = remote.filter((suggestion) => !seen.has(suggestion.key) && seen.add(suggestion.key));
			suggestions = [...local, ...extra].slice(0, MAX_TOTAL);
			render();
		}, REMOTE_DELAY);
	};

	input.addEventListener('input', () => { void update(); });
	input.addEventListener('focus', () => { void loadLocal(); });
	input.addEventListener('blur', close);

	input.addEventListener('keydown', (event) => {
		if (list.hidden) {
			if (event.key === 'ArrowDown' && input.value.trim()) {
				event.preventDefault();
				void update();
			}
			return;
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			active = (active + step + suggestions.length + 1) % (suggestions.length + 1);
			if (active === suggestions.length) active = -1;
			render();
		} else if (event.key === 'Enter' && active >= 0) {
			// Picking a suggestion shouldn't also submit the form.
			event.preventDefault();
			choose(active);
		} else if (event.key === 'Escape') {
			// Close the list, not the dialog around it.
			event.preventDefault();
			event.stopPropagation();
			close();
		}
	});

	// pointerdown, not click: a click would blur the input (closing the list) before it lands.
	list.addEventListener('pointerdown', (event) => {
		const option = (event.target as HTMLElement).closest('li');
		if (!option) return;
		event.preventDefault();
		choose([...list.children].indexOf(option));
	});

	return { close };
};
