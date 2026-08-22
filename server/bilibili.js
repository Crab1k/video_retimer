const { createHash, randomUUID } = require('node:crypto');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const REFERER = 'https://www.bilibili.com';
const VIEW_API = 'https://api.bilibili.com/x/web-interface/view';
const PLAYURL_HTML5 = 'https://api.bilibili.com/x/player/playurl';
const PLAYURL_WBI = 'https://api.bilibili.com/x/player/wbi/playurl';
const NAV_API = 'https://api.bilibili.com/x/web-interface/nav';

const MIXIN_KEY_ENC_TAB = [
	46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
	33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
	61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
	36, 20, 34, 44, 52,
];

const BV_RE = /^BV[1-9A-HJ-NP-Za-km-z]{10}$/;
const AV_RE = /^\d{1,12}$/;
const SHORT_RE = /^[A-Za-z0-9]{4,12}$/;

const buvid3 = `${randomUUID().replace(/-/g, '').slice(0, 32).toUpperCase()}infoc`;
let wbiKeys = null;
let wbiKeysFetchedAt = 0;

function md5(text) {
	return createHash('md5').update(text).digest('hex');
}

function mixinKey(orig) {
	return MIXIN_KEY_ENC_TAB.map((n) => orig[n]).join('').slice(0, 32);
}

function signWbi(params, imgKey, subKey) {
	const signed = { ...params, wts: Math.round(Date.now() / 1000) };
	const query = Object.keys(signed)
		.sort()
		.map((key) => {
			const value = String(signed[key]).replace(/[!'()*]/g, '');
			return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
		})
		.join('&');
	return `${query}&w_rid=${md5(query + mixinKey(imgKey + subKey))}`;
}

function biliHeaders(extra = {}) {
	return {
		Accept: 'application/json, text/plain, */*',
		'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
		'User-Agent': UA,
		Referer: `${REFERER}/`,
		Origin: REFERER,
		Cookie: `buvid3=${buvid3}`,
		...extra,
	};
}

async function biliFetch(url, init = {}) {
	const res = await fetch(url, {
		...init,
		headers: {
			...biliHeaders(),
			...init.headers,
		},
	});
	return res;
}

function apiError(message, status = 400) {
	const err = new Error(message);
	err.status = status;
	return err;
}

function parsePage(value) {
	const page = Number.parseInt(value, 10);
	if (!Number.isFinite(page) || page < 1) return 1;
	return page;
}

async function resolveShortId(shortId) {
	if (!SHORT_RE.test(shortId)) throw apiError('Invalid Bilibili short link');
	const res = await fetch(`https://b23.tv/${shortId}`, {
		method: 'GET',
		redirect: 'manual',
		headers: biliHeaders(),
	});
	const location = res.headers.get('location');
	if (!location) throw apiError('Could not resolve Bilibili short link', 502);
	return location;
}

function parseBilibiliUrl(rawUrl) {
	let parsed;
	try {
		parsed = new URL(rawUrl);
	} catch {
		throw apiError('Invalid Bilibili URL');
	}

	const host = parsed.hostname.replace(/^www\./, '');
	if (host === 'b23.tv' || host === 'bili2233.cn') {
		return { shortId: parsed.pathname.replace(/^\//, '').split('/')[0] };
	}
	if (!host.endsWith('bilibili.com')) throw apiError('Not a Bilibili URL');

	const bvMatch = parsed.pathname.match(/\/video\/(BV[1-9A-HJ-NP-Za-km-z]{10})/i);
	const avMatch = parsed.pathname.match(/\/video\/av(\d+)/i);
	const t = parsed.searchParams.get('t');
	const p = parsePage(parsed.searchParams.get('p'));
	if (bvMatch) return { bvid: bvMatch[1], p, t };
	if (avMatch) return { aid: avMatch[1], p, t };
	throw apiError('Unsupported Bilibili URL');
}

async function getWbiKeys() {
	if (wbiKeys && Date.now() - wbiKeysFetchedAt < 60 * 60 * 1000) return wbiKeys;
	const res = await biliFetch(NAV_API);
	if (!res.ok) throw apiError('Failed to reach Bilibili', 502);
	const json = await res.json();
	const imgUrl = json?.data?.wbi_img?.img_url;
	const subUrl = json?.data?.wbi_img?.sub_url;
	if (!imgUrl || !subUrl) throw apiError('Failed to get Bilibili playback keys', 502);
	wbiKeys = {
		imgKey: imgUrl.slice(imgUrl.lastIndexOf('/') + 1, imgUrl.lastIndexOf('.')),
		subKey: subUrl.slice(subUrl.lastIndexOf('/') + 1, subUrl.lastIndexOf('.')),
	};
	wbiKeysFetchedAt = Date.now();
	return wbiKeys;
}

const QN_LABELS = {
	16: '360p',
	32: '480p',
	64: '720p',
	74: '720p60',
	80: '1080p',
	112: '1080p+',
	116: '1080p60',
	120: '4K',
};
const ALLOWED_QN = Object.keys(QN_LABELS).map(Number);

function parseQn(value) {
	const qn = Number.parseInt(value, 10);
	if (ALLOWED_QN.includes(qn)) return qn;
	return 80;
}

function streamUrl(item) {
	if (!item) return null;
	return item.baseUrl || item.base_url || item.backup_url?.[0] || item.backupUrl?.[0] || item.url || null;
}

function codecScore(codecs = '') {
	const value = String(codecs).toLowerCase();
	if (value.startsWith('avc') || value.startsWith('mp4a')) return 3;
	if (value.startsWith('av01')) return 2;
	if (value.startsWith('hvc') || value.startsWith('hev')) return 1;
	return 0;
}

function inferFps(data, qn, video) {
	const dashFps = Number(video?.frameRate || video?.frame_rate || data?.dash?.video?.[0]?.frameRate);
	if (dashFps > 0) return Math.round(dashFps);
	const current = Number(data?.quality) || Number(qn);
	if (current === 74 || current === 116) return 60;
	return null;
}

function pickMp4(data, qn) {
	const url = streamUrl(data?.durl?.[0]);
	if (!url) return null;
	return {
		url,
		audioUrl: null,
		kind: 'mp4',
		quality: Number(data.quality) || null,
		fps: inferFps(data, qn),
		separateAudio: false,
	};
}

function pickDash(data, qn) {
	const wanted = parseQn(qn);
	const videos = (data?.dash?.video || []).filter((item) => Number(item.id) === wanted);
	if (!videos.length) return null;
	videos.sort((a, b) => codecScore(b.codecs) - codecScore(a.codecs) || (b.bandwidth || 0) - (a.bandwidth || 0));
	const video = videos[0];
	const audios = [...(data?.dash?.audio || [])]
		.sort((a, b) => codecScore(b.codecs) - codecScore(a.codecs) || (b.bandwidth || 0) - (a.bandwidth || 0));
	const audio = audios[0];
	const url = streamUrl(video);
	if (!url) return null;
	return {
		url,
		audioUrl: streamUrl(audio),
		kind: 'dash',
		quality: wanted,
		fps: inferFps(data, wanted, video),
		separateAudio: true,
	};
}

function mergeQualities(html5Data, dashData) {
	const html5Qn = new Set();
	(html5Data?.accept_quality || []).forEach((id) => html5Qn.add(Number(id)));
	if (html5Data?.durl && html5Data.quality) html5Qn.add(Number(html5Data.quality));
	const dashQn = new Set((dashData?.dash?.video || []).map((item) => Number(item.id)));
	const ids = new Set([...html5Qn, ...dashQn]);
	const list = [...ids]
		.filter((qn) => ALLOWED_QN.includes(qn))
		.sort((a, b) => a - b)
		.map((qn) => ({
			qn,
			label: QN_LABELS[qn] || String(qn),
			separateAudio: !html5Qn.has(qn) && dashQn.has(qn),
		}));
	if (list.length) return list;
	return [16, 32, 64, 80].map((qn) => ({ qn, label: QN_LABELS[qn], separateAudio: false }));
}

async function fetchPlayData(info, extraParams) {
	const params = {
		bvid: info.bvid,
		cid: String(info.cid),
		...extraParams,
	};
	const query = new URLSearchParams(params);
	const html5Res = await biliFetch(`${PLAYURL_HTML5}?${query}`);
	if (html5Res.ok) {
		const json = await html5Res.json();
		if (json.code === 0 && json.data) return json.data;
	}
	const keys = await getWbiKeys();
	const signed = signWbi(params, keys.imgKey, keys.subKey);
	const wbiRes = await biliFetch(`${PLAYURL_WBI}?${signed}`);
	if (!wbiRes.ok) throw apiError('Failed to get Bilibili playback URL', 502);
	const wbiJson = await wbiRes.json();
	if (wbiJson.code !== 0 || !wbiJson.data) {
		throw apiError(wbiJson.message || 'Bilibili refused playback', 502);
	}
	return wbiJson.data;
}

async function requestPlayUrl(info, qn = 80) {
	const wanted = parseQn(qn);
	const shared = {
		qn: String(wanted),
		fnver: '0',
		fourk: '1',
		try_look: '1',
	};
	const [html5Data, dashData] = await Promise.all([
		fetchPlayData(info, {
			...shared,
			fnval: '0',
			platform: 'html5',
			high_quality: '1',
		}).catch(() => null),
		fetchPlayData(info, {
			...shared,
			fnval: '4048',
		}).catch(() => null),
	]);
	const qualities = mergeQualities(html5Data, dashData);
	const mp4 = pickMp4(html5Data, wanted);
	if (mp4 && Number(html5Data.quality) === wanted) {
		return { ...mp4, qualities };
	}
	const dash = pickDash(dashData, wanted);
	if (dash) return { ...dash, qualities };
	if (mp4) return { ...mp4, qualities };
	throw apiError('This Bilibili video has no playable stream.', 422);
}

async function resolveVideo({ bvid, aid, shortId, p }) {
	let resolvedBvid = bvid;
	let resolvedAid = aid;
	let page = parsePage(p);

	if (shortId) {
		const location = await resolveShortId(shortId);
		const parsed = parseBilibiliUrl(location);
		if (parsed.shortId) throw apiError('Could not resolve Bilibili short link', 502);
		resolvedBvid = parsed.bvid;
		resolvedAid = parsed.aid;
		if (parsed.p) page = parsed.p;
	}

	if (resolvedBvid && !BV_RE.test(resolvedBvid)) throw apiError('Invalid Bilibili BV id');
	if (resolvedAid && !AV_RE.test(String(resolvedAid))) throw apiError('Invalid Bilibili av id');
	if (!resolvedBvid && !resolvedAid) throw apiError('Missing Bilibili video id');

	const query = resolvedBvid ? `bvid=${encodeURIComponent(resolvedBvid)}` : `aid=${encodeURIComponent(resolvedAid)}`;
	const res = await biliFetch(`${VIEW_API}?${query}`);
	if (!res.ok) throw apiError('Failed to reach Bilibili', 502);
	const json = await res.json();
	if (json.code !== 0 || !json.data) {
		throw apiError(json.message || 'Bilibili video not found', json.code === -404 ? 404 : 502);
	}

	const pages = json.data.pages || [];
	const pageInfo = pages[Math.min(page, pages.length) - 1];
	if (!pageInfo?.cid) throw apiError('Bilibili part not found', 404);

	return {
		bvid: json.data.bvid,
		aid: json.data.aid,
		cid: pageInfo.cid,
		title: json.data.title,
		part: pageInfo.part,
		page: pageInfo.page || page,
		duration: pageInfo.duration,
		pageCount: pages.length,
	};
}

const playCache = new Map();
const PLAY_TTL_MS = 8 * 60 * 1000;

function playCacheKey(query) {
	return [
		query.bvid || '',
		query.aid || '',
		query.shortId || '',
		parsePage(query.p),
		parseQn(query.qn),
	].join(':');
}

async function resolvePlayable(query, { refresh = false } = {}) {
	const key = playCacheKey(query);
	if (!refresh) {
		const hit = playCache.get(key);
		if (hit && Date.now() - hit.at < PLAY_TTL_MS) return hit.value;
	}
	const info = await resolveVideo(query);
	const play = await requestPlayUrl(info, query.qn);
	const value = {
		...info,
		playUrl: play.url,
		audioUrl: play.audioUrl || null,
		kind: play.kind,
		quality: play.quality,
		qualities: play.qualities,
		fps: play.fps,
		separateAudio: !!play.separateAudio,
	};
	playCache.set(key, { at: Date.now(), value });
	return value;
}

function invalidatePlayable(query) {
	playCache.delete(playCacheKey(query));
}

module.exports = {
	BV_RE,
	biliHeaders,
	parseBilibiliUrl,
	resolveVideo,
	resolvePlayable,
	invalidatePlayable,
	UA,
};
