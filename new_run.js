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
}

function getLocalVideoFps(videoPlayer) {
	// https://stackoverflow.com/a/73094937/19702779
	let lastMediaTimer;
	let lastFrameNum;
	let fps;
	const fpsRounder = [];
	let frameNotSeeked = true;
	function getFpsAverage() {
		return fpsRounder.reduce((a, b) => a + b) / fpsRounder.length;
	}
	function ticker(_now, metadata) {
		const mediaTimeDiff = Math.abs(metadata.mediaTime - lastMediaTimer);
		const frameNumDiff = Math.abs(metadata.presentedFrames - lastFrameNum);
		const diff = mediaTimeDiff / frameNumDiff;
		if (
			diff
			&& diff < 1
			&& frameNotSeeked
			&& fpsRounder.length < 50
			&& videoPlayer.playbackRate === 1
			&& document.hasFocus()
		) {
			fpsRounder.push(diff);
			fps = Math.round(1 / getFpsAverage());
			console.log(`FPS: ${fps}, certainty: ${fpsRounder.length * 2}%`);
			if (fpsRounder.length === 50) {
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
	else alert("Couldn't auto detect framerate because 'requestVideoFrameCallback' is unsupported. Please get the framerate manually and put it in the framerate input!");
	videoPlayer.addEventListener('seeked', () => {
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
			if (youtube) return;
			// eslint-disable-next-line no-undef
			youtube = new YT.Player(videoIframe, {
				videoId,
				playerVars: {
					rel: 0,
					origin: youtubeOrigin,
					enablejsapi: 1,
					playsinline: 1,
					widget_referrer: window.location.href,
				},
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
		const page = searchParams.get('p') || '1';
		const streamParams = new URLSearchParams({ p: page });
		if (searchParams.get('short') === '1') streamParams.set('short', videoId);
		else if (searchParams.get('aid') === '1') streamParams.set('aid', videoId);
		else streamParams.set('bvid', videoId);

		function bindHtml5Player() {
			player = {
				seekTo(timestamp) {
					videoPlayer.currentTime = timestamp;
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
		}

		function loadLocalBilibiliFile() {
			const input = document.createElement('input');
			input.type = 'file';
			input.accept = 'video/*';
			input.onchange = () => {
				const file = input.files?.[0];
				if (!file) return;
				videoPlayer.src = URL.createObjectURL(file);
				videoPlayer.load();
				getLocalVideoFps(videoPlayer);
			};
			input.click();
		}

		function showBilibiliError(message) {
			const useLocal = window.confirm(`${message}\n\nLoad a local video file instead?`);
			if (useLocal) loadLocalBilibiliFile();
		}

		videoIframe.remove();
		videoPlayer.style.display = 'block';
		bindHtml5Player();
		videoPlayer.addEventListener('loadedmetadata', onPlayerReady, { once: true });
		videoPlayer.addEventListener('error', () => {
			showBilibiliError('Could not play this Bilibili video through the retimer server.');
		});

		(async () => {
			try {
				const infoRes = await fetch(`/api/bilibili/info?${streamParams}`);
				if (!infoRes.ok) {
					const body = await infoRes.json().catch(() => ({}));
					throw new Error(body.error || `Server error ${infoRes.status}`);
				}
				videoPlayer.src = `/api/bilibili/stream?${streamParams}`;
				videoPlayer.load();
				getLocalVideoFps(videoPlayer);
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
