// liveChatMessages.streamList over HTTP answers with one JSON array that grows while the connection is open:
// `[{…page…}` then `,{…page…}` and so on. This picks out each complete top-level object as it arrives.

export class JsonArrayStreamParser {
	private buffer = '';
	private depth = 0;
	private inString = false;
	private escaped = false;
	private objectStart = -1;
	private scanned = 0;

	/** Feeds a chunk of text; returns the objects it completed. */
	push(chunk: string): unknown[] {
		this.buffer += chunk;
		const done: unknown[] = [];
		for (let index = this.scanned; index < this.buffer.length; index++) {
			const character = this.buffer[index];
			if (this.inString) {
				if (this.escaped) this.escaped = false;
				else if (character === '\\') this.escaped = true;
				else if (character === '"') this.inString = false;
				continue;
			}
			if (character === '"') this.inString = true;
			else if (character === '{' || character === '[') {
				if (character === '{' && this.depth === 1) this.objectStart = index;
				this.depth++;
			} else if (character === '}' || character === ']') {
				this.depth--;
				if (character === '}' && this.depth === 1 && this.objectStart >= 0) {
					done.push(JSON.parse(this.buffer.slice(this.objectStart, index + 1)));
					this.objectStart = -1;
				}
			}
		}
		// Keep only an unfinished object, so the buffer doesn't grow for the life of the connection.
		if (this.objectStart >= 0) {
			this.buffer = this.buffer.slice(this.objectStart);
			this.objectStart = 0;
		} else {
			this.buffer = '';
		}
		this.scanned = this.buffer.length;
		return done;
	}
}
