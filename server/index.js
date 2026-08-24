const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const express = require('express');
const { biliHeaders, resolvePlayable, invalidatePlayable } = require('./bilibili');

const app = express();
const root = path.resolve(__dirname, '..');
const indexFile = path.join(root, 'index.html');
const PORT = process.env.PORT || 3000;

function sendHome(_req, res) {
	res.sendFile(indexFile);
}

function sendError(res, err) {
	const status = err.status || 500;
	res.status(status).json({ error: err.message || 'Unexpected server error' });
}

function queryFromRequest(req) {
	return {
		bvid: req.query.bvid,
		aid: req.query.aid,
		shortId: req.query.short,
		p: req.query.p,
		qn: req.query.qn,
	};
}

app.use((_req, res, next) => {
	res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
	next();
});

app.get('/api/health', (_req, res) => {
	res.json({ ok: true });
});

app.get('/api/screamer', (_req, res) => {
	res.setHeader('cache-control', 'no-store');
	res.json({ enabled: process.env.SCREAMER_ENABLED === '1' });
});

app.get('/api/bilibili/info', async (req, res) => {
	try {
		const playable = await resolvePlayable(queryFromRequest(req));
		res.json({
			bvid: playable.bvid,
			aid: playable.aid,
			cid: playable.cid,
			title: playable.title,
			part: playable.part,
			page: playable.page,
			duration: playable.duration,
			pageCount: playable.pageCount,
			quality: playable.quality,
			qualities: playable.qualities,
			fps: playable.fps,
			separateAudio: playable.separateAudio,
		});
	} catch (err) {
		sendError(res, err);
	}
});

async function fetchBilibiliCdn(playable, url, rangeHeader) {
	const headers = biliHeaders({
		Referer: `https://www.bilibili.com/video/${playable.bvid}`,
	});
	if (rangeHeader) headers.Range = rangeHeader;
	return fetch(url, { headers });
}

async function proxyBilibili(req, res, pickUrl) {
	try {
		const query = queryFromRequest(req);
		let playable = await resolvePlayable(query);
		let url = pickUrl(playable);
		if (!url) {
			res.status(204).end();
			return;
		}
		let upstream = await fetchBilibiliCdn(playable, url, req.headers.range);
		if (upstream.status === 403 || upstream.status === 404) {
			invalidatePlayable(query);
			playable = await resolvePlayable(query, { refresh: true });
			url = pickUrl(playable);
			if (!url) {
				res.status(204).end();
				return;
			}
			upstream = await fetchBilibiliCdn(playable, url, req.headers.range);
		}
		if (!upstream.ok && upstream.status !== 206) {
			res.status(502).json({ error: 'Bilibili CDN refused the video stream' });
			return;
		}

		res.status(upstream.status);
		['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach((name) => {
			const value = upstream.headers.get(name);
			if (value) res.setHeader(name, value);
		});
		if (!res.getHeader('accept-ranges')) res.setHeader('accept-ranges', 'bytes');
		res.setHeader('cache-control', 'private, max-age=120');

		if (!upstream.body) {
			res.end();
			return;
		}

		const nodeStream = Readable.fromWeb(upstream.body);
		const onClose = () => nodeStream.destroy();
		req.on('close', onClose);
		nodeStream.on('error', () => {
			if (!res.headersSent) res.status(502);
			res.end();
		});
		nodeStream.pipe(res);
	} catch (err) {
		if (res.headersSent) {
			res.end();
			return;
		}
		sendError(res, err);
	}
}

const proxyVideo = (req, res) => proxyBilibili(req, res, (playable) => playable.playUrl);
const proxyAudio = (req, res) => proxyBilibili(req, res, (playable) => playable.audioUrl);

app.get('/api/bilibili/stream', proxyVideo);
app.head('/api/bilibili/stream', proxyVideo);
app.get('/api/bilibili/audio', proxyAudio);
app.head('/api/bilibili/audio', proxyAudio);

app.get(['/', '/index.html'], sendHome);
app.use(express.static(root, { index: 'index.html' }));
app.get('*', (req, res, next) => {
	if (req.method !== 'GET' || req.path.startsWith('/api/')) {
		next();
		return;
	}
	const accept = req.headers.accept || '';
	if (!accept.includes('text/html')) {
		next();
		return;
	}
	sendHome(req, res);
});

app.listen(PORT, () => {
	console.log(`Retimer server running at http://localhost:${PORT}`);
	console.log(`Static root: ${root} (index.html ${fs.existsSync(indexFile) ? 'found' : 'MISSING'})`);
});
