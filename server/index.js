const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const express = require('express');
const { biliHeaders, resolvePlayable, resolveVideo } = require('./bilibili');

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
		});
	} catch (err) {
		sendError(res, err);
	}
});

async function proxyBilibili(req, res) {
	try {
		const playable = await resolvePlayable(queryFromRequest(req));
		const headers = biliHeaders({
			Referer: `https://www.bilibili.com/video/${playable.bvid}`,
		});
		if (req.headers.range) headers.Range = req.headers.range;

		const upstream = await fetch(playable.playUrl, { headers });
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
		res.setHeader('cache-control', 'no-store');

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

app.get('/api/bilibili/stream', proxyBilibili);
app.head('/api/bilibili/stream', proxyBilibili);

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
