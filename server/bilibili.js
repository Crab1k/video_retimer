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

function qualityList(data) {
	const ids = data?.accept_quality || [];
	const names = data?.accept_description || [];
	const seen = new Set();
	const list = [];
	ids.forEach((id, index) => {
		const qn = Number(id);
		if (!ALLOWED_QN.includes(qn) || seen.has(qn)) return;
		seen.add(qn);
		list.push({
			qn,
			label: names[index] || QN_LABELS[qn] || String(qn),
		});
	});
	if (!list.length) {
		return ALLOWED_QN.slice(0, 4).map((qn) => ({ qn, label: QN_LABELS[qn] }));
	}
	return list.sort((a, b) => a.qn - b.qn);
}

function inferFps(data, qn) {
	const dashFps = Number(data?.dash?.video?.[0]?.frameRate);
	if (dashFps > 0) return Math.round(dashFps);
	const current = Number(data?.quality) || Number(qn);
	if (current === 74 || current === 116) return 60;
	return null;
}

function pickPlayUrl(data, qn) {
	const mp4 = data?.durl?.[0]?.url || data?.durl?.[0]?.backup_url?.[0];
	if (mp4) {
		return {
			url: mp4,
			kind: 'mp4',
			quality: Number(data.quality) || null,
			qualities: qualityList(data),
			fps: inferFps(data, qn),
		};
	}
	return null;
}

async function requestPlayUrl(info, qn = 80) {
	const baseParams = {
		bvid: info.bvid,
		cid: String(info.cid),
		qn: String(parseQn(qn)),
		fnval: '0',
		fnver: '0',
		fourk: '1',
		platform: 'html5',
		high_quality: '1',
	};

	const html5Query = new URLSearchParams(baseParams);
	const html5Res = await biliFetch(`${PLAYURL_HTML5}?${html5Query}`);
	if (html5Res.ok) {
		const html5Json = await html5Res.json();
		const picked = pickPlayUrl(html5Json?.data, qn);
		if (picked) return picked;
	}

	const keys = await getWbiKeys();
	const signed = signWbi(baseParams, keys.imgKey, keys.subKey);
	const wbiRes = await biliFetch(`${PLAYURL_WBI}?${signed}`);
	if (!wbiRes.ok) throw apiError('Failed to get Bilibili playback URL', 502);
	const wbiJson = await wbiRes.json();
	if (wbiJson.code !== 0) {
		throw apiError(wbiJson.message || 'Bilibili refused playback', 502);
	}
	const picked = pickPlayUrl(wbiJson.data, qn);
	if (picked) return picked;
	throw apiError('This Bilibili video has no HTML5 MP4 stream.', 422);
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
		quality: play.quality,
		qualities: play.qualities,
		fps: play.fps,
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
