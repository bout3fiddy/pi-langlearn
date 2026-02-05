export function createDebouncedRender(requestRender: () => void, delayMs = 50): {
	request: () => void;
	flush: () => void;
	dispose: () => void;
} {
	let timer: ReturnType<typeof setTimeout> | null = null;
	const request = () => {
		if (timer) return;
		timer = setTimeout(() => {
			timer = null;
			requestRender();
		}, delayMs);
	};
	const flush = () => {
		if (!timer) return;
		clearTimeout(timer);
		timer = null;
		requestRender();
	};
	const dispose = () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
	};
	return { request, flush, dispose };
}
