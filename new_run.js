/* eslint-disable no-mixed-operators */
/* eslint-disable no-param-reassign */
/* eslint-disable no-unused-vars */
/* eslint-disable no-inner-declarations */

function interpolate(template, variables) {
	return template.replace(/\${[^{]+}/g, (match) => {
		const path = match.slice(2, -1).trim();
		return variables[path];
	});
}

function format(duration) {
	// Calculate the hours, minutes, and seconds using modulo operators.
	const hours = duration / 3600000 | 0; /* eslint-disable-line no-bitwise */
	const minutes = (duration / 60000) % 60 | 0; /* eslint-disable-line no-bitwise */
	const seconds = (duration / 1000) % 60 | 0; /* eslint-disable-line no-bitwise */
	const milliseconds = duration % 1000;

	// Format the time.
	const formattedTime = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;

	return formattedTime;
}

// Initialise URL Params
const searchParams = new URLSearchParams(window.location.search);
const videoIframe = document.querySelector('iframe');
const videoId = searchParams.get('id');
const type = searchParams.get('type');
const time = +searchParams.get('t');
if (type === 't' || type === 'b') {
	videoIframe.hidden = true;
}

// Load page elements
const totalTimeSpan = document.getElementById('total-time');
const startSpan = document.getElementById('start');
const goToStartButton = document.getElementById('go-to-start');
const endSpan = document.getElementById('end');
const goToEndButton = document.getElementById('go-to-end');
const currentTimeSpan = document.getElementById('current-time');
const modMessageText = document.getElementById('modMessage');
const modMessageButton = document.getElementById('modMessageButton');
const currentFrameSpan = document.getElementById('current-frame');
const framerateElement = document.getElementById('framerate');
const templatePauseElement = document.getElementById('pause-template');
const pauseContainer = document.getElementById('pause-container');
const fpsInfoButton = document.getElementById('fpsinfo');
const vidInfoButton = document.getElementById('vidinfo');
// eslint-disable-next-line no-template-curly-in-string
const currentModMessage = localStorage.getItem('currentModMessage') || 'Mod Message: Time starts at ${start} and ends at ${end}${pauses}with a framerate of ${framerate} FPS to get a final time of ${timeStr}.\nRetimed using [Video Retimer+](https://video-retimer.onrender.com/)';
const pauseTimes = [];
// Create page variables
let start = null;
let end = null;
let currentMillis = 0;
let currentFrame = 0;
let framerate = 30;
let pauseCount = 0;
let userChoseFps = false;
let isFpsDetected = false;
// let isLoaded = false;
let showVidInfo = false;
let twitch;
let youtube;

const customFramerate = localStorage.getItem('framerate');
if (customFramerate) framerateElement.value = customFramerate;

// Fallback Player
let player = {
	seekTo() {
		throw Error('unimplemented');
	},
	pauseVideo() {
		throw Error('unimplemented');
	},
	getCurrentTime() {
		throw Error('unimplemented');
	},
	playVideo() {
		throw Error('unimplemented');
	},
};

function updateTotalTime() {
	// handle negative time I guess
	if (start !== null && end !== null && start <= end) {
		// eslint-disable-next-line no-mixed-operators
		const endFrame = Math.floor(end / 1000 * framerate);
		const startFrame = Math.floor(start / 1000 * framerate);
		let frames = endFrame - startFrame;
		for (let i = 0; i < pauseTimes.length; i++) {
			const pauseStart = pauseTimes[i][0];
			const pauseEnd = pauseTimes[i][1];
			if (pauseStart !== undefined && pauseEnd !== undefined && pauseStart <= pauseEnd) {
				const pauseEndFrame = Math.floor(pauseEnd / 1000 * framerate);
				const pauseStartFrame = Math.floor(pauseStart / 1000 * framerate);
				frames -= pauseEndFrame - pauseStartFrame;
			}
		}

		const ms = Math.floor((frames * 1000) / framerate);

		const timeStr = format(ms);
		const params = {
			start: format(start),
			end: format(end),
			timeStr,
			framerate,
			pauses: ' ',
		};
		if (pauseTimes.length) {
			// eslint-disable-next-line quotes
			params.pauses = ` with pauses ${pauseTimes.map((x) => (x[0] !== undefined && x[1] !== undefined && x[0] <= x[1] ? `from ${format(x[0])} to ${format(x[1])} ` : '')).join('and ')}`;
		}

		const modMessage = interpolate(currentModMessage, params);
		totalTimeSpan.innerHTML = timeStr;
		modMessageText.value = modMessage;

		modMessageButton.disabled = false;
		modMessageText.disabled = false;
	}
}

function validateFramerate(isFromUser) {
	const newFramerate = parseFloat(framerateElement.value);
	if (!newFramerate) return;
	framerate = newFramerate;
	if (isFromUser) userChoseFps = true;
	framerateElement.value = framerate;
	updateTotalTime();
}

function updateCurrentTime() {
	try {
		const seconds = player.getCurrentTime();
		currentMillis = Math.floor((seconds || 0) * 1000);
		currentFrame = Math.floor((seconds || 0) * framerate);
	} catch {
		currentMillis = 0;
		currentFrame = 0;
	}
}

function updateCurrentTimeSpan() {
	updateCurrentTime();
	currentTimeSpan.innerHTML = currentMillis;
	currentFrameSpan.innerHTML = currentFrame;
}

function setTime(millis) {
	updateCurrentTimeSpan();
	player.pauseVideo();
	player.seekTo(millis);
}

function stepBy(amount) {
	player.pauseVideo();
	updateCurrentTime();
	setTime(Math.ceil(((currentFrame + amount) / framerate) * 1000) / 1000);
	armScreamer(amount);
}

let screamerEnabled = false;
let screamerArmed = false;
fetch('/api/screamer')
	.then((res) => res.json())
	.then((data) => {
		screamerEnabled = data.enabled === true;
	})
	.catch(() => {});

function playScreamSound() {
	const AudioCtx = window.AudioContext || window.webkitAudioContext;
	if (!AudioCtx) return;
	const ctx = new AudioCtx();
	const duration = 1.3;
	const now = ctx.currentTime;
	const gain = ctx.createGain();
	gain.gain.setValueAtTime(0.0001, now);
	gain.gain.exponentialRampToValueAtTime(0.4, now + 0.03);
	gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
	gain.connect(ctx.destination);

	const osc = ctx.createOscillator();
	osc.type = 'sawtooth';
	osc.frequency.setValueAtTime(380, now);
	osc.frequency.exponentialRampToValueAtTime(1600, now + 0.12);
	osc.frequency.exponentialRampToValueAtTime(220, now + duration);
	osc.connect(gain);
	osc.start(now);
	osc.stop(now + duration);

	const noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
	const samples = noiseBuffer.getChannelData(0);
	for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
	const noise = ctx.createBufferSource();
	noise.buffer = noiseBuffer;
	const noiseGain = ctx.createGain();
	noiseGain.gain.setValueAtTime(0.25, now);
	noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
	noise.connect(noiseGain);
	noiseGain.connect(ctx.destination);
	noise.start(now);
	noise.stop(now + duration);
}

function playScreamer() {
	const overlay = document.getElementById('screamer');
	if (!overlay) return;
	overlay.hidden = false;
	playScreamSound();
	setTimeout(() => {
		overlay.hidden = true;
	}, 10000);
}

function armScreamer(amount) {
	if (!screamerEnabled || screamerArmed) return;
	if (amount !== 1 && amount !== -1) return;
	const onlyOneBound = (start === null) !== (end === null);
	if (!onlyOneBound) return;
	screamerArmed = true;
	setTimeout(playScreamer, 1000);
}

let fpsDetectGeneration = 0;
function getLocalVideoFps(videoPlayer) {
	// https://stackoverflow.com/a/73094937/19702779
	const generation = ++fpsDetectGeneration;
	let lastMediaTimer;
	let lastFrameNum;
	let fps;
	const fpsRounder = [];
	let frameNotSeeked = true;
	function getFpsAverage() {
		return fpsRounder.reduce((a, b) => a + b) / fpsRounder.length;
	}
	function ticker(_now, metadata) {
		if (generation !== fpsDetectGeneration || userChoseFps) return;
		const mediaTimeDiff = Math.abs(metadata.mediaTime - lastMediaTimer);
		const frameNumDiff = Math.abs(metadata.presentedFrames - lastFrameNum);
		const diff = mediaTimeDiff / frameNumDiff;
		if (
			diff
			&& diff < 1
			&& frameNotSeeked
			&& fpsRounder.length < 20
			&& videoPlayer.playbackRate === 1
		) {
			fpsRounder.push(diff);
			fps = Math.round(1 / getFpsAverage());
			console.log(`FPS: ${fps}, certainty: ${fpsRounder.length * 5}%`);
			if (fpsRounder.length === 20) {
				framerate = fps;
				validateFramerate();
				return;
			}
		}
		frameNotSeeked = true;
		lastMediaTimer = metadata.mediaTime;
		lastFrameNum = metadata.presentedFrames;
		videoPlayer.requestVideoFrameCallback(ticker);
	}
	if ('requestVideoFrameCallback' in videoPlayer) videoPlayer.requestVideoFrameCallback(ticker);
	videoPlayer.addEventListener('seeked', () => {
		if (generation !== fpsDetectGeneration) return;
		fpsRounder.pop();
		frameNotSeeked = false;
	});
}

function copyModMessage() {
	// Allow user to copy mod message to clipboard

	modMessageText.focus();
	modMessageText.select();
	document.execCommand('copy');
	alert('The mod message has been copied to clipboard! Please paste it into the comment of the run you are verifying.');

	/*
	// I dont know why this approach doesn't work. If you can fix it please make a pull request
	function oldCopy() {
		modMessageText.focus();
		modMessageText.select();
		document.execCommand('copy');
		alert('The mod message has been copied to clipboard! '
		+ 'Please paste it into the comment of the run you are verifying.');
	}
	const result = await navigator.permissions.query({ name: 'clipboard-write' });
	console.log(result.state);
	if (result.state === 'granted') {
		navigator.clipboard.writeText(modMessageText.innerText).then(
			() => {
				alert('The mod message has been copied to clipboard! '
				+ 'Please paste it into the comment of the run you are verifying.');
			},
			oldCopy,
		);
	} else {
		oldCopy();
	}
	*/
}

function showStart() {
	if (start === null) {
		return;
	}

	startSpan.innerHTML = start;
	goToStartButton.style.display = 'inline';
}

function setStart() {
	updateCurrentTime();
	start = currentMillis;
	showStart();
	updateTotalTime();
}

function goToStart() {
	setTime(start / 1000);
}

function showEnd() {
	if (end === null) {
		return;
	}

	endSpan.innerHTML = end;
	goToEndButton.style.display = 'inline';
}

function setEnd() {
	updateCurrentTime();
	end = currentMillis;
	showEnd();
	updateTotalTime();
}

function goToEnd() {
	setTime(end / 1000);
}

function toggleVideoInfo() {
	if (showVidInfo) {
		youtube.hideVideoInfo();
		vidInfoButton.innerText = 'Show Video Info';
		showVidInfo = false;
	} else {
		youtube.showVideoInfo();
		vidInfoButton.innerText = 'Hide Video Info';
		showVidInfo = true;
	}
}

function onPlayerReady() {
	player.playVideo();
	if (time) player.seekTo(time);
	setInterval(updateCurrentTimeSpan, 50);
}

function onPlayerPlaying() {
	if (userChoseFps || isFpsDetected) return;
	const qualities = twitch.getQualities();
	console.log('Qualities:', qualities);
	let fps = qualities?.[1].framerate;
	if (fps) {
		isFpsDetected = true;
		framerateElement.value = fps;
	} else {
		setTimeout(() => {
			const stats = twitch.getPlaybackStats();
			console.log('Stats:', stats);
			fps = stats.fps;
			if (fps) {
				isFpsDetected = true;
				framerateElement.value = fps;
			} else alert('FPS could\'nt be detected. please enter the fps manually (You can click \'Show Video Info\' to retrieve it, Twitch VODs have variable framerate so consider rounding 28 or 33 to 30 and so on)');
		}, 1000);
	}
	validateFramerate();
}

// Load the player.
switch (type) {
	case 'y':
	{
		fpsInfoButton.style.display = 'inline';
		vidInfoButton.style.display = 'inline';
		const youtubeOrigin = window.location.origin;
		videoIframe.src = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?enablejsapi=1&origin=${encodeURIComponent(youtubeOrigin)}`;

		function onYoutubeError(event) {
			console.log(event);
			if (event?.data === 5 || event?.data === '5') return;
		}

		function onYoutubeReady() {
			player = {
				seekTo(timestamp) {
					youtube.seekTo(timestamp, true);
				},
				pauseVideo() {
					youtube.pauseVideo();
				},
				getCurrentTime() {
					return youtube.getCurrentTime() || 0;
				},
				playVideo() {
					youtube.playVideo();
				},
			};
			onPlayerReady();
		}
		function createYoutubePlayer() {
			if (youtube || !(window.YT && window.YT.Player)) return;
			// eslint-disable-next-line no-undef
			youtube = new YT.Player('video-iframe', {
				events: {
					onReady: onYoutubeReady,
					onError: onYoutubeError,
				},
			});
		}
		if (window.YT && window.YT.Player) {
			createYoutubePlayer();
		} else {
			window.onYouTubeIframeAPIReady = createYoutubePlayer;
			window.onYouTubePlayerAPIReady = createYoutubePlayer;
			const tag = document.createElement('script');
			tag.src = 'https://www.youtube.com/iframe_api';
			document.head.appendChild(tag);
		}
		break;
	}
	case 't':
	{
		// eslint-disable-next-line no-undef
		twitch = new Twitch.Player('video-div', {
			video: videoId,
		});

		player = {
			seekTo(timestamp) {
				// player.playVideo();
				twitch.seek(timestamp);
				// player.pauseVideo();
			},
			pauseVideo() {
				twitch.pause();
			},
			getCurrentTime() {
				return twitch.getCurrentTime();
			},
			playVideo() {
				twitch.play();
			},
		};
		// eslint-disable-next-line no-undef
		twitch.addEventListener(Twitch.Player.READY, onPlayerReady);
		// eslint-disable-next-line no-undef
		twitch.addEventListener(Twitch.Player.PLAYING, onPlayerPlaying);
		break;
	}
	case 'n':
	{
		const nicoPlayerId = 'retimer';
		const nicoOrigin = 'https://embed.nicovideo.jp';
		let nicoCurrentMs = 0;
		let nicoTimeScale = 1000;
		let nicoLengthSeconds = 0;
		let nicoReady = false;
		let nicoFailed = false;

		function nicoPost(eventName, data) {
			if (!videoIframe.contentWindow) return;
			const message = {
				eventName,
				sourceConnectorType: 1,
				playerId: nicoPlayerId,
			};
			if (data !== undefined) message.data = data;
			videoIframe.contentWindow.postMessage(message, nicoOrigin);
		}

		function markNicoReady() {
			if (nicoReady || nicoFailed) return;
			nicoReady = true;
			onPlayerReady();
		}

		player = {
			seekTo(timestamp) {
				nicoPost('seek', { time: timestamp * nicoTimeScale });
			},
			pauseVideo() {
				nicoPost('pause');
			},
			getCurrentTime() {
				return nicoCurrentMs / 1000;
			},
			playVideo() {
				nicoPost('play');
			},
		};

		window.addEventListener('message', (event) => {
			if (event.origin !== nicoOrigin) return;
			const payload = event.data || {};
			if (payload.playerId && payload.playerId !== nicoPlayerId) return;
			const eventName = payload.eventName;
			const data = payload.data || {};

			if (eventName === 'error' || payload.code === 'possibly_deleted_video' || payload.code === 'externally_unwatchable') {
				if (nicoFailed) return;
				nicoFailed = true;
				alert(payload.message || data.message || 'This Niconico video cannot be embedded.');
				return;
			}

			if (eventName === 'loadComplete') {
				const length = Number(data.videoInfo?.lengthInSeconds);
				if (length > 0) nicoLengthSeconds = length;
				nicoPost('commentVisibilityChange', { commentVisibility: false });
				markNicoReady();
			}

			if (eventName === 'playerMetadataChange') {
				const rawTime = Number(data.currentTime);
				const rawDuration = Number(data.duration);
				if (nicoLengthSeconds > 0 && rawDuration > nicoLengthSeconds * 5) nicoTimeScale = 1000;
				else if (nicoLengthSeconds > 0 && Math.abs(rawDuration - nicoLengthSeconds) < 2) nicoTimeScale = 1;
				if (Number.isFinite(rawTime)) {
					nicoCurrentMs = nicoTimeScale === 1000 ? rawTime : rawTime * 1000;
				}
				markNicoReady();
			}
		});

		const from = time > 0 ? `&from=${Math.floor(time)}` : '';
		videoIframe.src = `${nicoOrigin}/watch/${encodeURIComponent(videoId)}?jsapi=1&playerId=${encodeURIComponent(nicoPlayerId)}${from}`;
		break;
	}
	case 'd':
	{
		let driveUser = 0;
		let srcUrl = `https://drive.google.com/uc?export=download&id=${videoId}`;
		const driveAPIKey = 'AIzaSyCv76of8z_m0jnOflw0rFQ50gphUBFvwcw';
		const maxDriveUsers = 4;
		const videoPlayer = document.getElementById('video');
		videoIframe.remove();
		videoPlayer.setAttribute('src', srcUrl);
		videoPlayer.load();
		getLocalVideoFps(videoPlayer);
		videoPlayer.style.display = 'block';
		videoPlayer.onerror = () => {
			// console.log("error loading drive video");
			if (driveUser < maxDriveUsers - 1) {
				driveUser++;
				srcUrl = `https://drive.google.com/u/${driveUser}/uc?export=download&id=${videoId}`;
				videoPlayer.setAttribute('src', srcUrl);
				videoPlayer.load();
				getLocalVideoFps(videoPlayer);
			} else if (driveUser === maxDriveUsers - 1) {
				// unless there are more than 10 users, the file is large
				srcUrl = `https://www.googleapis.com/drive/v3/files/${videoId}?alt=media&key=${driveAPIKey}`;
				videoPlayer.setAttribute('src', srcUrl);
				videoPlayer.load();
				getLocalVideoFps(videoPlayer);
				driveUser = maxDriveUsers;
			}
		};
		player = {
			seekTo(timestamp) {
				// player.playVideo();
				videoPlayer.currentTime = timestamp;
				// player.pauseVideo();
			},
			pauseVideo() {
				videoPlayer.pause();
			},
			getCurrentTime() {
				return videoPlayer.currentTime;
			},
			playVideo() {
				videoPlayer.play();
			},
		};
		break;
	}
	case 'b':
	{
		const videoPlayer = document.getElementById('video');
		const qualityWrap = document.getElementById('bili-quality-wrap');
		const qualitySelect = document.getElementById('bili-quality');
		const volumeWrap = document.getElementById('bili-volume-wrap');
		const volumeSlider = document.getElementById('bili-volume');
		const page = searchParams.get('p') || '1';
		const streamParams = new URLSearchParams({ p: page });
		if (searchParams.get('short') === '1') streamParams.set('short', videoId);
		else if (searchParams.get('aid') === '1') streamParams.set('aid', videoId);
		else streamParams.set('bvid', videoId);

		const audioPlayer = new Audio();
		audioPlayer.preload = 'auto';
		let qualitiesMeta = [];
		let applyingBiliVolume = false;

		function biliVolumeValue() {
			const stored = Number.parseFloat(localStorage.getItem('biliVolume'));
			if (Number.isFinite(stored)) return Math.min(1, Math.max(0, stored));
			return 1;
		}

		function applyBiliVolume(value) {
			const volume = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : biliVolumeValue();
			applyingBiliVolume = true;
			videoPlayer.volume = volume;
			videoPlayer.muted = volume === 0;
			audioPlayer.volume = volume;
			audioPlayer.muted = volume === 0;
			if (volumeSlider) volumeSlider.value = String(Math.round(volume * 100));
			localStorage.setItem('biliVolume', String(volume));
			applyingBiliVolume = false;
		}

		function qualityHasAudio(qn) {
			return !!qualitiesMeta.find((item) => String(item.qn) === String(qn))?.separateAudio;
		}

		function syncBiliAudio(force) {
			if (!audioPlayer.getAttribute('src')) return;
			const drift = Math.abs(audioPlayer.currentTime - videoPlayer.currentTime);
			if (force || drift > 0.2) audioPlayer.currentTime = videoPlayer.currentTime;
			audioPlayer.playbackRate = videoPlayer.playbackRate;
		}

		function bindHtml5Player() {
			player = {
				seekTo(timestamp) {
					videoPlayer.currentTime = timestamp;
					if (audioPlayer.getAttribute('src')) audioPlayer.currentTime = timestamp;
				},
				pauseVideo() {
					videoPlayer.pause();
					audioPlayer.pause();
				},
				getCurrentTime() {
					return videoPlayer.currentTime;
				},
				playVideo() {
					videoPlayer.play();
					if (audioPlayer.getAttribute('src')) audioPlayer.play().catch(() => {});
				},
			};
		}

		function showBilibiliError(message) {
			alert(message);
		}

		let ignoreNextMediaError = false;
		let streamReloads = 0;

		function loadBilibiliStream(resumeAt) {
			const resume = Number.isFinite(resumeAt) ? resumeAt : videoPlayer.currentTime || 0;
			ignoreNextMediaError = true;
			const restore = () => {
				if (resume > 0.25) videoPlayer.currentTime = resume;
				syncBiliAudio(true);
				ignoreNextMediaError = false;
				videoPlayer.removeEventListener('loadedmetadata', restore);
			};
			videoPlayer.addEventListener('loadedmetadata', restore);
			videoPlayer.src = `/api/bilibili/stream?${streamParams}`;
			videoPlayer.load();
			if (qualityHasAudio(streamParams.get('qn'))) {
				audioPlayer.src = `/api/bilibili/audio?${streamParams}`;
				audioPlayer.load();
			} else {
				audioPlayer.pause();
				audioPlayer.removeAttribute('src');
				audioPlayer.load();
			}
			applyBiliVolume();
			getLocalVideoFps(videoPlayer);
		}

		function fillQualities(info) {
			qualitiesMeta = info.qualities || [];
			qualitySelect.innerHTML = '';
			qualitiesMeta.forEach((item) => {
				const option = document.createElement('option');
				option.value = String(item.qn);
				option.textContent = item.label;
				qualitySelect.appendChild(option);
			});
			const has = (qn) => [...qualitySelect.options].some((option) => option.value === String(qn));
			const stored = localStorage.getItem('biliQn');
			let preferred = '';
			if (stored && has(stored)) preferred = stored;
			else if (has('64')) preferred = '64';
			else preferred = String(info.quality || '');
			if (preferred && has(preferred)) qualitySelect.value = preferred;
			if (qualitySelect.value) streamParams.set('qn', qualitySelect.value);
			qualityWrap.style.display = qualitiesMeta.length ? 'inline' : 'none';
			if (info.fps && !userChoseFps) {
				framerateElement.value = info.fps;
				validateFramerate();
			}
		}

		qualitySelect.onchange = () => {
			streamParams.set('qn', qualitySelect.value);
			localStorage.setItem('biliQn', qualitySelect.value);
			streamReloads = 0;
			loadBilibiliStream(videoPlayer.currentTime || 0);
		};

		videoIframe.remove();
		videoPlayer.style.display = 'block';
		volumeWrap.style.display = 'inline';
		applyBiliVolume();
		volumeSlider.oninput = () => applyBiliVolume(Number(volumeSlider.value) / 100);
		videoPlayer.addEventListener('volumechange', () => {
			if (applyingBiliVolume) return;
			applyBiliVolume(videoPlayer.muted ? 0 : videoPlayer.volume);
		});
		bindHtml5Player();
		videoPlayer.addEventListener('loadedmetadata', onPlayerReady, { once: true });
		videoPlayer.addEventListener('play', () => {
			if (audioPlayer.getAttribute('src')) {
				syncBiliAudio(true);
				audioPlayer.play().catch(() => {});
			}
		});
		videoPlayer.addEventListener('pause', () => audioPlayer.pause());
		videoPlayer.addEventListener('seeked', () => syncBiliAudio(true));
		videoPlayer.addEventListener('waiting', () => audioPlayer.pause());
		videoPlayer.addEventListener('ratechange', () => {
			audioPlayer.playbackRate = videoPlayer.playbackRate;
		});
		videoPlayer.addEventListener('timeupdate', () => syncBiliAudio(false));
		videoPlayer.addEventListener('playing', () => {
			streamReloads = 0;
			ignoreNextMediaError = false;
			if (audioPlayer.getAttribute('src')) audioPlayer.play().catch(() => {});
		});
		videoPlayer.addEventListener('error', () => {
			const code = videoPlayer.error?.code;
			if (ignoreNextMediaError || code === MediaError.MEDIA_ERR_ABORTED) return;
			if (streamReloads < 2 && (code === MediaError.MEDIA_ERR_NETWORK || code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED)) {
				streamReloads++;
				loadBilibiliStream(videoPlayer.currentTime || 0);
				return;
			}
			showBilibiliError('Could not play this Bilibili video through the retimer server.');
		});

		(async () => {
			try {
				const infoRes = await fetch(`/api/bilibili/info?${streamParams}`);
				if (!infoRes.ok) {
					const body = await infoRes.json().catch(() => ({}));
					throw new Error(body.error || `Server error ${infoRes.status}`);
				}
				fillQualities(await infoRes.json());
				loadBilibiliStream();
			} catch (err) {
				if (err instanceof TypeError) {
					showBilibiliError('Bilibili videos need the retimer server. Run npm start and open http://localhost:3000');
					return;
				}
				showBilibiliError(err.message);
			}
		})();
		break;
	}
	default:
		document.body.innerText = "You shouldn't be here";
		break;
}

function parseForTime(event) {
	framerate = parseInt(document.getElementById('framerateAlt').value || framerate, 10);
	const json = JSON.parse(event.target.value);
	let { lct } = json;
	// if lct is undefined that means the user gave a number so we set it back to the json
	if (lct === undefined) lct = json;
	// eslint-disable-next-line no-restricted-globals
	if (event.target.id === 'startobj') start = lct * 1000 | 0; /* eslint-disable-line no-bitwise */
	else end = lct * 1000 | 0; /* eslint-disable-line no-bitwise */
	document.getElementById(event.target.id).value = `${Math.floor(lct * framerate) / framerate}`;
}
function addPause() {
	const pause = templatePauseElement.cloneNode(true);
	pauseCount++;
	pause.id = pauseCount;
	// for each div in the pause element, set the data-id to the pause id
	// this will allow us to access the pause id from the buttons' click events
	pause.childNodes.forEach((el) => {
		if (el.tagName === 'DIV') {
			// eslint-disable-next-line default-case
			switch (el.id) {
				case 'pause-start-div':
				{
					el.querySelector('#set-pause-start').dataset.id = pause.id;
					el.querySelector('#go-to-start-pause').dataset.id = pause.id;
					break;
				}
				case 'pause-end-div':
				{
					el.querySelector('#set-pause-end').dataset.id = pause.id;
					el.querySelector('#go-to-end-pause').dataset.id = pause.id;
					break;
				}
				case 'pause-delete-div':
				{
					el.querySelector('#delete-pause').dataset.id = pause.id;
					break;
				}
			}
		}
	});
	pause.style.display = 'block';
	pauseContainer.appendChild(pause);
}
function deletePause(el) {
	console.log(el.dataset);
	const parentDiv = document.getElementById(el.dataset.id);
	pauseTimes.splice(parseInt(parentDiv.id) - 1, 1);
	parentDiv.remove();
	pauseCount--;
	updateTotalTime();
}
function showPauseEnd(el) {
	const parentDiv = document.getElementById(el.dataset.id);
	const pauseEnd = pauseTimes[parseInt(parentDiv.id) - 1][1];
	if (pauseEnd === null) {
		return;
	}

	parentDiv.querySelector('#pause-end').innerHTML = pauseEnd;
	parentDiv.querySelector('#go-to-end-pause').style.display = 'inline';
}
function showPauseStart(el) {
	const parentDiv = document.getElementById(el.dataset.id);
	const pauseStart = pauseTimes[parseInt(parentDiv.id) - 1][0];
	if (pauseStart === null) {
		return;
	}

	parentDiv.querySelector('#pause-start').innerHTML = pauseStart;
	parentDiv.querySelector('#go-to-start-pause').style.display = 'inline';
}
function setPauseStart(el) {
	updateCurrentTime();
	const parentDiv = document.getElementById(el.dataset.id);
	const id = parseInt(parentDiv.id) - 1;
	if (!pauseTimes[id]) pauseTimes[id] = [];
	pauseTimes[id][0] = currentMillis;
	showPauseStart(el);
	updateTotalTime();
}
function setPauseEnd(el) {
	updateCurrentTime();
	const parentDiv = document.getElementById(el.dataset.id);
	const id = parseInt(parentDiv.id) - 1;
	if (!pauseTimes[id]) pauseTimes[id] = [];
	pauseTimes[id][1] = currentMillis;
	showPauseEnd(el);
	updateTotalTime();
}
function goToPauseEnd(el) {
	const parentDiv = document.getElementById(el.dataset.id);
	setTime(pauseTimes[parseInt(parentDiv.id) - 1][1] / 1000);
}
function goToPauseStart(el) {
	const parentDiv = document.getElementById(el.dataset.id);
	setTime(pauseTimes[parseInt(parentDiv.id) - 1][0] / 1000);
}
// fpsInfoButton.addEventListener('mouseover', () => {
// 	if (type === 'y') document.getElementById('popup').style.display = 'block';
// });

// fpsInfoButton.addEventListener('mouseout', () => {
// 	if (type === 'y') document.getElementById('popup').style.display = 'none';
// });

if (type === 'y') {
	fpsInfoButton.addEventListener('mouseover', () => {
		document.getElementById('popup').style.display = 'block';
	});
	fpsInfoButton.addEventListener('mouseout', () => {
		document.getElementById('popup').style.display = 'none';
	});
}
