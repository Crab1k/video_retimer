/* eslint-disable max-len */
/* eslint-disable no-unused-vars */
const inputUrl = document.getElementById('url');
const ytRegex = /youtu(?:be\..+?|.be)\/(?:watch.*?v=|embed\/|shorts\/|)([A-Za-z0-9_-]+).*?((?<=(?:\?|&)t=))*(\d+)*/;
const twitchRegex = /twitch\.tv\/videos\/(\d+)(?:\?t=)?(.+)?/;
const driveRegex = /drive\.google\.com\/file\/d\/(.*)\//;
const biliBvRegex = /bilibili\.com\/video\/(BV[1-9A-HJ-NP-Za-km-z]{10})/i;
const biliAvRegex = /bilibili\.com\/video\/av(\d+)/i;
const biliShortRegex = /(?:b23\.tv|bili2233\.cn)\/([A-Za-z0-9]+)/i;

inputUrl.focus();

const select = document.getElementsByTagName('select')[0];
select.value = localStorage.getItem('LA') || 'EN';
select.onchange = (event) => {
	localStorage.setItem('LA', event.target.value);
	// eslint-disable-next-line no-undef
	translatePage(false);
};

function parseTwitchId(vodUrl) {
	const reg = vodUrl.match(twitchRegex);
	if (reg && reg.length >= 2) return [reg[1], reg[2]];
	return [null];
}

function parseYoutubeId(videoUrl) {
	const reg1 = videoUrl.match(ytRegex);
	if (reg1 && reg1.length >= 2) return [reg1[1], reg1[2]];
	return [null];
}

function parseDriveId(videoUrl) {
	const reg = videoUrl.match(driveRegex);
	if (reg && reg.length >= 2) return reg[1];
	return null;
}

function redirectYoutube(url) {
	const [id, t] = parseYoutubeId(url);
	if (id) window.location.href = `/new_run.html?id=${id}&type=y${t ? `&t=${t}` : ''}`;
}

function redirectTwitch() {
	// eslint-disable-next-line prefer-const
	let [id, t] = parseTwitchId(inputUrl.value);
	if (t) {
		const timeArr = t.split(/h|m/);
		if (timeArr.length === 3) t = parseInt(timeArr[0]) * 3600 + parseInt(timeArr[1]) * 60 + parseInt(timeArr[2]);
		else if (timeArr.length === 2) t = parseInt(timeArr[0]) * 60 + parseInt(timeArr[1]);
		else if (timeArr.length === 1) t = parseInt(timeArr[0]);
	}
	if (id) window.location.href = `/new_run.html?id=${id}&type=t${t ? `&t=${t}` : ''}`;
}

function redirectDrive(url) {
	const id = parseDriveId(url);
	if (id) window.location.href = `/new_run.html?id=${id}&type=d`;
}

function withProtocol(rawUrl) {
	const trimmed = rawUrl.trim();
	if (!trimmed) return trimmed;
	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
	return `https://${trimmed}`;
}

function parseBilibiliTime(rawUrl) {
	try {
		const parsed = new URL(withProtocol(rawUrl));
		const t = parsed.searchParams.get('t');
		if (!t) return '';
		if (/^\d+(?:\.\d+)?$/.test(t)) return t;
		const hours = Number((t.match(/(\d+)h/) || [])[1] || 0);
		const minutes = Number((t.match(/(\d+)m/) || [])[1] || 0);
		const seconds = Number((t.match(/(\d+)s/) || [])[1] || 0);
		const total = hours * 3600 + minutes * 60 + seconds;
		return total ? String(total) : '';
	} catch {
		return '';
	}
}

function parseBilibiliPage(rawUrl) {
	try {
		return new URL(withProtocol(rawUrl)).searchParams.get('p') || '1';
	} catch {
		return '1';
	}
}

function parseBilibili(rawUrl) {
	const short = rawUrl.match(biliShortRegex);
	if (short) return { short: short[1], p: parseBilibiliPage(rawUrl), t: parseBilibiliTime(rawUrl) };
	const bv = rawUrl.match(biliBvRegex);
	if (bv) return { bvid: bv[1], p: parseBilibiliPage(rawUrl), t: parseBilibiliTime(rawUrl) };
	const av = rawUrl.match(biliAvRegex);
	if (av) return { aid: av[1], p: parseBilibiliPage(rawUrl), t: parseBilibiliTime(rawUrl) };
	return null;
}

function parseNiconicoTime(rawUrl) {
	try {
		const parsed = new URL(withProtocol(rawUrl));
		const from = parsed.searchParams.get('from') || parsed.searchParams.get('t');
		if (!from) return '';
		if (/^\d+(?:\.\d+)?$/.test(from)) return from;
		const hours = Number((from.match(/(\d+)h/) || [])[1] || 0);
		const minutes = Number((from.match(/(\d+)m/) || [])[1] || 0);
		const seconds = Number((from.match(/(\d+)s/) || [])[1] || 0);
		const total = hours * 3600 + minutes * 60 + seconds;
		return total ? String(total) : '';
	} catch {
		return '';
	}
}

function parseNiconico(rawUrl) {
	let parsed;
	try {
		parsed = new URL(withProtocol(rawUrl));
	} catch {
		return null;
	}
	const host = parsed.hostname.replace(/^(www|sp|embed)\./, '');
	if (host !== 'nicovideo.jp' && host !== 'nico.ms') return null;
	const match = host === 'nico.ms'
		? parsed.pathname.match(/^\/((?:sm|nm|so|nc)\d+)/i)
		: parsed.pathname.match(/\/watch\/((?:sm|nm|so|nc)\d+)/i);
	if (!match) return null;
	return { id: match[1], t: parseNiconicoTime(rawUrl) };
}

function redirectNiconico(url) {
	const parsed = parseNiconico(url);
	if (!parsed) return;
	const params = new URLSearchParams({ type: 'n', id: parsed.id });
	if (parsed.t) params.set('t', parsed.t);
	window.location.href = `/new_run.html?${params}`;
}

function redirectBilibili(url) {
	const parsed = parseBilibili(url);
	if (!parsed) return;
	const params = new URLSearchParams({ type: 'b' });
	if (parsed.bvid) params.set('id', parsed.bvid);
	if (parsed.aid) {
		params.set('id', parsed.aid);
		params.set('aid', '1');
	}
	if (parsed.short) {
		params.set('id', parsed.short);
		params.set('short', '1');
	}
	if (parsed.p && parsed.p !== '1') params.set('p', parsed.p);
	if (parsed.t) params.set('t', parsed.t);
	window.location.href = `/new_run.html?${params}`;
}

function redirect() {
	const url = inputUrl.value;
	redirectYoutube(url);
	redirectTwitch(url);
	redirectDrive(url);
	redirectBilibili(url);
	redirectNiconico(url);
}

if ('serviceWorker' in navigator) {
	window.addEventListener('load', () => {
		navigator.serviceWorker.register('./ServiceWorker.js');
	});
}
