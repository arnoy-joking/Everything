        // API CONFIGURATION (Native YouTubeI)
        const PROXY = null; // Extension handles CORS via declarativeNetRequest
        const API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
        const CLIENT_WEB = '2.20260130.01.00';
        const CLIENT_ANDROID = '21.04.223';
        const RADIO_APIS = ['https://long-pond-4887.arnoy799.workers.dev/', 'https://jolly-hall-c603.arnoy799.workers.dev/'];
        
        function getRandomAPI(apiArray) { return apiArray[Math.floor(Math.random() * apiArray.length)]; }
        
        const STORAGE_KEYS = { HISTORY: 'music_history', FAVORITES: 'music_favorites', VIEW_MODE: 'music_view_mode', SETTINGS: 'music_settings', BLACKLIST: 'music_blacklist', TOP_SONGS_CACHE: 'music_top_songs_cache' };
        
        let currentQueue = [], currentIndex = -1, isPlaying = false;
        let updateInterval, isVideoVisible = false, currentView = 'home', lastResults = [], pendingPlayIndex = -1;
        let viewMode = 'grid', isFullPlayerOpen = false, fullPlayerMode = 'art'; 
        let currentLyrics = [], currentCaptionUrl = null;
        
        // Native Player Element
        const videoElement = document.getElementById('native-player');
        
        const SVG_PLAY = '<path d="M8 5v14l11-7z"/>';
        const SVG_PAUSE = '<path d="M6 19h4V5H6zm8-14v14h4V5z"/>';

        const StorageManager = {
            get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } },
            set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; } },
            getThumbnailUrl(videoId) { return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`; },
            getHistory() { return this.get(STORAGE_KEYS.HISTORY) || { searches: [], plays: [], queue_history: [] }; },
            saveHistory(history) { this.set(STORAGE_KEYS.HISTORY, history); },
            getFavorites() { return this.get(STORAGE_KEYS.FAVORITES) || []; },
            saveFavorites(favorites) { this.set(STORAGE_KEYS.FAVORITES, favorites); },
            getSettings() { return this.get(STORAGE_KEYS.SETTINGS) || { videoSize: 320, sidebarCollapsed: false, geniusApiKey: '', incognito: false, volume: 100 }; },
            saveSettings(settings) { this.set(STORAGE_KEYS.SETTINGS, settings); },
            getBlacklist() { return this.get(STORAGE_KEYS.BLACKLIST) || []; },
            addToBlacklist(videoId) {
                const list = this.getBlacklist();
                if (!list.includes(videoId)) { list.push(videoId); this.set(STORAGE_KEYS.BLACKLIST, list); }
            },
            addSearch(query) {
                if (this.getSettings().incognito) return;
                const history = this.getHistory();
                const existing = history.searches.find(s => s.query.toLowerCase() === query.toLowerCase());
                if (existing) { existing.count++; existing.timestamp = Date.now(); } 
                else { history.searches.push({ query, timestamp: Date.now(), count: 1 }); }
                history.searches = history.searches.slice(-50);
                this.saveHistory(history);
            },
            addPlay(video) {
                if (this.getSettings().incognito) return;
                const history = this.getHistory();
                const existing = history.plays.findIndex(p => p.videoId === video.videoId);
                if (existing > -1) { history.plays.splice(existing, 1); }
                history.plays.unshift({
                    videoId: video.videoId, title: video.title, channel: video.channel,
                    playCount: (history.plays[existing]?.playCount || 0) + 1, lastPlayed: Date.now()
                });
                history.plays = history.plays.slice(-100);
                this.saveHistory(history);
            },
            addToQueue(video, source = 'search') {
                if (this.getSettings().incognito) return;
                const history = this.getHistory();
                history.queue_history.push({ videoId: video.videoId, title: video.title, channel: video.channel, addedAt: Date.now(), playedFrom: source });
                history.queue_history = history.queue_history.slice(-200);
                this.saveHistory(history);
            },
            toggleFavorite(video) {
                let favorites = this.getFavorites();
                const index = favorites.findIndex(f => f.videoId === video.videoId);
                if (index > -1) favorites.splice(index, 1);
                else favorites.push({ videoId: video.videoId, title: video.title, channel: video.channel, addedAt: Date.now() });
                this.saveFavorites(favorites);
                return index === -1;
            },
            isFavorite(videoId) { return this.getFavorites().some(f => f.videoId === videoId); },
            getViewMode() { return this.get(STORAGE_KEYS.VIEW_MODE) || 'grid'; },
            setViewMode(mode) { this.set(STORAGE_KEYS.VIEW_MODE, mode); }
        };

        // NEW API MANAGER
        const ApiManager = {
            async search(query) {
                try {
                    const url = `https://www.youtube.com/youtubei/v1/search?key=${API_KEY}`;
                    const res = await fetch(url, {
                        method: "POST",
                        body: JSON.stringify({ context: { client: { clientName: "WEB", clientVersion: CLIENT_WEB } }, query: query })
                    });
                    const data = await res.json();
                    const items = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];
                    
                    return items.map(item => {
                        const v = item.videoRenderer;
                        if(!v) return null;
                        return {
                            videoId: v.videoId,
                            title: v.title.runs[0].text,
                            channel: v.ownerText.runs[0].text,
                            thumbnail: v.thumbnail.thumbnails[v.thumbnail.thumbnails.length - 1].url,
                            duration: v.lengthText?.simpleText || '',
                            views: v.shortViewCountText?.simpleText || v.viewCountText?.simpleText || ''
                        };
                    }).filter(i => i !== null);
                } catch(e) { console.error(e); return []; }
            },
            async getNext(videoId) {
                try {
                    const url = `https://www.youtube.com/youtubei/v1/next?key=${API_KEY}`;
                    const res = await fetch(url, {
                        method: 'POST',
                        body: JSON.stringify({
                            context: { client: { clientName: 'WEB', clientVersion: CLIENT_WEB, hl: 'en', gl: 'US' } },
                            videoId: videoId, playlistId: `RD${videoId}`
                        })
                    });
                    const data = await res.json();
                    const items = data?.contents?.twoColumnWatchNextResults?.playlist?.playlist?.contents || [];
                    return items.map(item => {
                        const v = item.playlistPanelVideoRenderer;
                        if(!v) return null;
                        return {
                            videoId: v.videoId,
                            title: v.title.simpleText || v.title.runs[0].text,
                            channel: v.longBylineText?.runs?.[0]?.text || "Unknown",
                            thumbnail: v.thumbnail.thumbnails[0].url
                        };
                    }).filter(i => i !== null);
                } catch(e) { console.error(e); return []; }
            },
            async getRadioFallback(videoId) {
                try {
                    const radioAPI = getRandomAPI(RADIO_APIS); 
                    const res = await fetchWithRetry(`${radioAPI}?videoId=${videoId}`);
                    return res.videos || [];
                } catch(e) { console.error("Fallback failed", e); return []; }
            },
            async getStreamData(videoId) {
                try {
                    const url = `https://www.youtube.com/youtubei/v1/player?key=${API_KEY}`;
                    const res = await fetch(url, {
                        method: "POST",
                        headers: { "User-Agent": `com.google.android.youtube/${CLIENT_ANDROID} (Linux; U; Android 15)` },
                        body: JSON.stringify({
                            context: { client: { clientName: "ANDROID", clientVersion: CLIENT_ANDROID, androidSdkVersion: 35, hl: "en", gl: "US" } },
                            videoId: videoId, contentCheckOk: true, racyCheckOk: true
                        })
                    });
                    const data = await res.json();
                    const formats = [...(data.streamingData?.formats || []), ...(data.streamingData?.adaptiveFormats || [])];
                    const stream = formats.find(f => f.mimeType.includes('video/mp4') && f.url);
                    
                    // Captions Logic
                    let captionUrl = null;
                    const captions = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
                    if(captions && captions.length > 0) {
                        const enTrack = captions.find(t => t.languageCode === 'en');
                        captionUrl = enTrack ? enTrack.baseUrl : captions[0].baseUrl;
                    }

                    return { streamUrl: stream ? stream.url : null, captionUrl: captionUrl };
                } catch(e) { console.error(e); return { streamUrl: null, captionUrl: null }; }
            },
            async fetchTopSongs() {
                const CACHE_DURATION = 24 * 60 * 60 * 1000;
                const cached = StorageManager.get(STORAGE_KEYS.TOP_SONGS_CACHE);
                if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) return cached.data;
                try {
                    const res = await fetch('https://icy-pine-f4fb.arnoy799.workers.dev/');
                    const data = await res.json();
                    const mapped = data.videos.map(v => ({
                        videoId: v.id, title: v.title, channel: v.author, thumbnail: v.thumbnail,
                        duration: v.duration, views: v.views, published: v.published
                    }));
                    StorageManager.set(STORAGE_KEYS.TOP_SONGS_CACHE, { timestamp: Date.now(), data: mapped });
                    return mapped;
                } catch(e) { console.error(e); return []; }
            }
        };

        const FeedGenerator = {
            generate() {
                const history = StorageManager.getHistory();
                const favorites = StorageManager.getFavorites();
                const blacklist = StorageManager.getBlacklist();
                const allVideos = new Map();
                const filterBlacklist = (v) => !blacklist.includes(v.videoId);
                history.plays.filter(filterBlacklist).forEach(p => allVideos.set(p.videoId, { ...p, thumbnail: StorageManager.getThumbnailUrl(p.videoId), source: 'played', score: 0 }));
                favorites.filter(filterBlacklist).forEach(f => {
                    if (!allVideos.has(f.videoId)) allVideos.set(f.videoId, { ...f, thumbnail: StorageManager.getThumbnailUrl(f.videoId), playCount: 0, lastPlayed: f.addedAt, source: 'favorite', score: 0 });
                    else allVideos.get(f.videoId).source = 'favorite';
                });
                history.queue_history.filter(filterBlacklist).forEach(q => {
                    if (allVideos.has(q.videoId) || !q.title) return;
                    allVideos.set(q.videoId, { ...q, thumbnail: StorageManager.getThumbnailUrl(q.videoId), playCount: 0, lastPlayed: q.addedAt, source: q.playedFrom || 'radio', score: 0 });
                });
                if (allVideos.size === 0) return [];
                const scored = this.scoreVideos(allVideos, history, favorites);
                return this.diversify(scored).slice(0, 50);
            },
            scoreVideos(allVideos, history, favorites) {
                const now = Date.now();
                const maxPlayCount = Math.max(...Array.from(allVideos.values()).map(v => v.playCount || 0), 1);
                allVideos.forEach((video, videoId) => {
                    const isFav = favorites.some(f => f.videoId === videoId);
                    const daysSince = (now - (video.lastPlayed || video.addedAt || now)) / (86400000);
                    let score = (video.playCount || 0) / maxPlayCount * 0.25;
                    score += Math.exp(-daysSince / 7) * 0.25;
                    if ((video.playCount || 0) === 0 && video.source === 'radio') score += 0.4;
                    if (isFav) score *= 1.5;
                    video.score = score + (Math.random() - 0.5) * 0.05;
                });
                return Array.from(allVideos.values()).sort((a, b) => b.score - a.score);
            },
            diversify(videos) { return videos; }
        };

        async function fetchWithRetry(url, maxRetries = 3) {
            for (let i = 0; i < maxRetries; i++) {
                try {
                    const response = await fetch(url);
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                    return await response.json();
                } catch (error) {
                    if (i < maxRetries - 1) await new Promise(resolve => setTimeout(resolve, 500));
                    else throw error;
                }
            }
        }

        // PARSE YOUTUBE CAPTIONS
        async function fetchYoutubeCaptions(url) {
            try {
                const res = await fetch(url);
                const text = await res.text();
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(text, "text/xml");
                const pTags = xmlDoc.getElementsByTagName('p');
                const lines = [];
                for(let p of pTags) {
                   if(p.textContent.trim()) {
                       lines.push({
                           start: parseInt(p.getAttribute('t')),
                           duration: parseInt(p.getAttribute('d') || 0),
                           text: p.textContent
                       });
                   }
                }
                return lines.length > 0 ? lines : null;
            } catch (e) { console.error("Caption Parse Error", e); return null; }
        }

        function formatTime(sec) {
            if(isNaN(sec)) return "0:00";
            const m = Math.floor(sec / 60);
            const s = Math.floor(sec % 60);
            return `${m}:${s < 10 ? '0'+s : s}`;
        }
        function formatViewCount(viewStr) {
            if (!viewStr) return '';
            if (/[KMBkmb]/.test(viewStr)) return viewStr.split(' ')[0];
            const num = parseInt(viewStr.replace(/[^0-9]/g, ''));
            if (isNaN(num)) return '';
            if (num >= 1000000000) return (num / 1000000000).toFixed(1).replace(/\.0$/, '') + 'B';
            if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
            if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
            return num.toString();
        }

        function updateIcons(playing) {
            const path = playing ? SVG_PAUSE : SVG_PLAY;
            document.getElementById('play-icon-desktop').innerHTML = path;
            document.getElementById('play-icon-mobile').innerHTML = path;
            document.getElementById('fp-play-icon').innerHTML = path;
            if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
        }
        function updateNavButtons() {
            const hasQueue = currentQueue.length > 0;
            ['prev-btn', 'next-btn', 'mobile-prev-btn', 'mobile-next-btn', 'fp-prev-btn', 'fp-next-btn'].forEach(id => {
                const btn = document.getElementById(id); if(btn) { btn.disabled = !hasQueue; btn.style.opacity = hasQueue ? '1' : '0.3'; }
            });
        }
        function updateLoveButton() {
            if (currentIndex === -1 || !currentQueue[currentIndex]) return;
            const videoId = currentQueue[currentIndex].videoId;
            const isLoved = StorageManager.isFavorite(videoId);
            ['love-btn', 'mobile-love-btn', 'fp-love-btn'].forEach(id => { const btn = document.getElementById(id); if (btn) btn.classList.toggle('loved', isLoved); });
        }
        function updateOpenInYtButton(videoId) {
            const btn = document.getElementById('open-yt-btn'), fpBtn = document.getElementById('fp-yt-btn');
            if(videoId) { const url = `https://www.youtube.com/watch?v=${videoId}`; btn.href = url; fpBtn.onclick = () => window.open(url, '_blank'); }
        }
        function updateLyricsButton(hasCaptions) {
            ['fp-lyrics-btn', 'footer-lyrics-btn'].forEach(id => {
                const btn = document.getElementById(id);
                if(btn) {
                    if(hasCaptions) { btn.classList.remove('hidden'); btn.classList.add(id === 'fp-lyrics-btn' ? 'flex' : 'block'); } 
                    else { btn.classList.add('hidden'); btn.classList.remove('flex', 'block'); }
                }
            });
        }
        function updateViewModeButtons() {
            const gridBtn = document.getElementById('view-grid-btn'), listBtn = document.getElementById('view-list-btn');
            if (!gridBtn || !listBtn) return;
            if (viewMode === 'grid') { gridBtn.classList.add('bg-white/10', 'text-white'); gridBtn.classList.remove('text-gray-400'); listBtn.classList.remove('bg-white/10', 'text-white'); listBtn.classList.add('text-gray-400'); }
            else { listBtn.classList.add('bg-white/10', 'text-white'); listBtn.classList.remove('text-gray-400'); gridBtn.classList.remove('bg-white/10', 'text-white'); gridBtn.classList.add('text-gray-400'); }
        }
        function updateMediaSession(track) {
            if ('mediaSession' in navigator) {
                const thumb = track.thumbnail || (track.thumbnails ? track.thumbnails[0].url : '');
                navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.channel, artwork: [{ src: thumb, sizes: '512x512', type: 'image/jpeg' }] });
                navigator.mediaSession.setActionHandler('play', playVideo); navigator.mediaSession.setActionHandler('pause', pauseVideo);
                navigator.mediaSession.setActionHandler('previoustrack', prevTrack); navigator.mediaSession.setActionHandler('nexttrack', nextTrack);
                navigator.mediaSession.setActionHandler('seekto', (details) => { if (videoElement) videoElement.currentTime = details.seekTime; });
            }
        }
        function updateIncognitoUI() {
            const isIncognito = StorageManager.getSettings().incognito;
            const ind = document.getElementById('incognito-indicator');
            if (isIncognito) ind.classList.remove('hidden'); else ind.classList.add('hidden');
        }

        // Native Player Logic
        videoElement.addEventListener('timeupdate', () => {
            const curr = videoElement.currentTime;
            const total = videoElement.duration;
            if (total > 0) {
                const pct = (curr / total) * 100;
                ['desktop-progress-bar', 'mobile-progress-bar', 'fp-progress-bar'].forEach(id => { const el = document.getElementById(id); if(el) el.style.width = pct + '%'; });
                if(document.getElementById('desktop-progress-thumb')) document.getElementById('desktop-progress-thumb').style.left = pct + '%';
                const tStr = formatTime(curr), dStr = formatTime(total);
                document.getElementById('current-time').innerText = tStr; document.getElementById('total-duration').innerText = dStr;
                document.getElementById('fp-current-time').innerText = tStr; document.getElementById('fp-total-duration').innerText = dStr;
                
                // Lyrics Sync Logic
                if (currentLyrics && !document.getElementById('lyrics-modal').classList.contains('hidden')) {
                    const timeMs = curr * 1000;
                    // Find active line
                    let activeIndex = -1;
                    for (let i = 0; i < currentLyrics.length; i++) {
                        if (timeMs >= currentLyrics[i].start) {
                            activeIndex = i;
                        } else {
                            break; 
                        }
                    }
                    
                    const container = document.getElementById('floating-lyrics-container');
                    const lines = container.children;
                    
                    // Update classes
                    for (let i = 0; i < lines.length; i++) {
                        if (i === activeIndex) {
                            if(!lines[i].classList.contains('active')) {
                                lines[i].classList.add('active');
                                lines[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }
                        } else {
                            lines[i].classList.remove('active');
                        }
                    }
                }
            }
        });
        videoElement.addEventListener('ended', nextTrack);
        videoElement.addEventListener('play', () => { isPlaying = true; updateIcons(true); if(currentIndex !== -1) updateMediaSession(currentQueue[currentIndex]); });
        videoElement.addEventListener('pause', () => { isPlaying = false; updateIcons(false); });

        async function loadTrack(index) {
            if (!currentQueue[index]) return;
            currentIndex = index; const track = currentQueue[index];
            const thumb = track.thumbnail || (track.thumbnails ? track.thumbnails[0].url : 'https://placehold.co/48x48/333/666?text=Music');
            
            document.getElementById('player-title').innerText = track.title; document.getElementById('player-artist').innerText = track.channel; document.getElementById('player-art').src = thumb;
            document.getElementById('fp-title').innerText = track.title; document.getElementById('fp-artist').innerText = track.channel; document.getElementById('fp-art-img').src = thumb;
            
            // Reset Lyrics
            currentLyrics = null; 
            currentCaptionUrl = null;
            document.getElementById('floating-lyrics-container').innerHTML = '<p class="text-gray-400">Loading...</p>';
            
            // FETCH STREAM DATA (URL + CAPTIONS)
            const streamData = await ApiManager.getStreamData(track.videoId);
            
            if(streamData.streamUrl) {
                videoElement.src = streamData.streamUrl;
                videoElement.play();
            } else {
                alert("Stream not available");
                nextTrack();
                return;
            }

            // Handle Captions
            currentCaptionUrl = streamData.captionUrl;
            updateLyricsButton(!!currentCaptionUrl);

            updateOpenInYtButton(track.videoId);
            StorageManager.addPlay(track); updateLoveButton(); renderQueue(); updateNavButtons();
            
            if (fullPlayerMode === 'queue') renderFullPlayerQueue();
        }

        async function toggleLyrics() {
            if(currentIndex === -1 || !currentQueue[currentIndex]) return;
            const modal = document.getElementById('lyrics-modal');
            const container = document.getElementById('floating-lyrics-container');
            const attribEl = document.getElementById('floating-lyrics-attribution');
            
            if(!modal.classList.contains('hidden')) { modal.classList.add('hidden'); return; }
            modal.classList.remove('hidden');
            
            if(currentLyrics) {
                // Already loaded, just showing
            } else if (currentCaptionUrl) {
                container.innerHTML = '<p class="text-gray-400">Fetching lyrics...</p>';
                attribEl.classList.add('hidden');
                
                const lines = await fetchYoutubeCaptions(currentCaptionUrl);
                
                if (lines) {
                    currentLyrics = lines;
                    container.innerHTML = ''; // Clear loading
                    lines.forEach((line, i) => {
                        const p = document.createElement('p');
                        p.className = 'lyrics-line text-lg text-gray-400 font-medium my-3 cursor-pointer';
                        p.textContent = line.text;
                        p.onclick = () => { videoElement.currentTime = line.start / 1000; videoElement.play(); };
                        container.appendChild(p);
                    });
                    attribEl.classList.remove('hidden');
                } else {
                    container.innerHTML = '<p class="text-gray-400">No lyrics available.</p>';
                }
            } else {
                container.innerHTML = '<p class="text-gray-400">No lyrics available.</p>';
                attribEl.classList.add('hidden');
            }
        }

        function playVideo() { videoElement.play(); }
        function pauseVideo() { videoElement.pause(); }
        function togglePlay() { videoElement.paused ? playVideo() : pauseVideo(); }
        function nextTrack() { if (currentQueue.length > 0) loadTrack((currentIndex + 1) >= currentQueue.length ? 0 : currentIndex + 1); }
        function prevTrack() { if (currentQueue.length > 0) loadTrack((currentIndex - 1) < 0 ? currentQueue.length - 1 : currentIndex - 1); }
        
        function seekTo(e, container) {
            if (!videoElement.duration) return;
            const rect = container.getBoundingClientRect(), pct = (e.clientX - rect.left) / rect.width;
            videoElement.currentTime = videoElement.duration * pct;
        }

        async function playSearchItem(video) {
            currentQueue = [video]; loadTrack(0); StorageManager.addToQueue({ videoId: video.videoId, title: video.title, channel: video.channel }, 'search');
            try {
                let radioItems = await ApiManager.getNext(video.videoId);
                if(radioItems.length === 0) {
                    // Fallback
                    console.log("Using Radio Fallback");
                    radioItems = await ApiManager.getRadioFallback(video.videoId);
                }
                
                if (radioItems.length > 0) { 
                    const newVideos = radioItems.filter(v => v.videoId !== video.videoId);
                    newVideos.forEach(v => { StorageManager.addToQueue({ videoId: v.videoId, title: v.title, channel: v.channel }, 'radio'); currentQueue.push(v); }); 
                    renderQueue(); 
                }
            } catch (e) { console.warn("Radio fail", e); }
        }

        async function performSearch(query) {
            if (!query) return;
            document.getElementById('content-section').innerHTML = `<h2 class="text-2xl font-bold mb-4">Searching "${query}"...</h2><div id="results-grid" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">${new Array(12).fill('<div class="p-3 rounded-xl"><div class="aspect-square rounded-lg skeleton mb-3"></div><div class="h-4 w-3/4 rounded skeleton mb-2"></div><div class="h-3 w-1/2 rounded skeleton"></div></div>').join('')}</div>`;
            try {
                lastResults = await ApiManager.search(query);
                StorageManager.addSearch(query);
                document.getElementById('content-section').innerHTML = `
                    <div class="flex items-center justify-between mb-6"><h2 class="text-2xl font-bold">Results for "${query}"</h2><div class="flex bg-[#212121] rounded-lg p-1"><button id="view-grid-btn" onclick="setViewMode('grid')" class="p-2 rounded-md"><svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M4 11h5V5H4v6zm0 7h5v-6H4v6zm6 0h5v-6h-5v6zm6 0h5v-6h-5v6zm-6-7h5V5h-5v6zm6-6v6h5V5h-5z"/></svg></button><button id="view-list-btn" onclick="setViewMode('list')" class="p-2 rounded-md"><svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg></button></div></div>
                    <div id="results-grid"></div>
                `;
                renderSearchResults(); updateViewModeButtons();
            } catch (e) { document.getElementById('content-section').innerHTML = `<p class="text-red-500">Error fetching results.</p>`; }
        }

        async function renderTopSongs() {
            document.getElementById('content-section').innerHTML = `<h2 class="text-2xl font-bold mb-4">Loading Top Songs...</h2><div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">${new Array(12).fill('<div class="p-3 rounded-xl"><div class="aspect-square rounded-lg skeleton mb-3"></div><div class="h-4 w-3/4 rounded skeleton mb-2"></div><div class="h-3 w-1/2 rounded skeleton"></div></div>').join('')}</div>`;
            lastResults = await ApiManager.fetchTopSongs();
            
            document.getElementById('content-section').innerHTML = `
                <div class="flex items-center justify-between mb-6">
                    <div><h2 class="text-2xl font-bold">Top 100 Global</h2><p class="text-xs text-gray-400 mt-1">Updated daily</p></div>
                    <div class="flex bg-[#212121] rounded-lg p-1">
                        <button id="view-grid-btn" onclick="setViewMode('grid')" class="p-2 rounded-md"><svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M4 11h5V5H4v6zm0 7h5v-6H4v6zm6 0h5v-6h-5v6zm6 0h5v-6h-5v6zm-6-7h5V5h-5v6zm6-6v6h5V5h-5z"/></svg></button>
                        <button id="view-list-btn" onclick="setViewMode('list')" class="p-2 rounded-md"><svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg></button>
                    </div>
                </div>
                <div id="results-grid"></div>
            `;
            renderSearchResults(); updateViewModeButtons();
        }

        function renderGenericGrid(containerId, videos, isRemovable = false) {
            const grid = document.getElementById(containerId);
            if (!grid) return;
            grid.innerHTML = '';
            
            if (viewMode === 'grid') {
                grid.className = "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4";
                videos.forEach(vid => {
                    const div = document.createElement('div');
                    div.className = "group relative p-4 rounded-xl hover:bg-[#282828] transition-all duration-300 ease-out cursor-pointer";
                    div.onclick = () => playSearchItem(vid);
                    
                    let metaHTML = '';
                    if (vid.views) metaHTML = `<div class="flex items-center text-[11px] text-gray-500 mt-0.5 space-x-1"><span>${formatViewCount(vid.views)} views</span><span class="text-gray-600">•</span><span>${vid.published || ''}</span></div>`;

                    div.innerHTML = `
                        <div class="relative aspect-square rounded-lg overflow-hidden mb-3 shadow-lg">
                            <img src="${vid.thumbnail}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy">
                            <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center backdrop-blur-[2px]">
                                <div class="w-12 h-12 bg-white text-black rounded-full flex items-center justify-center transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300 shadow-xl hover:scale-110">
                                    <svg class="w-6 h-6 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                </div>
                            </div>
                            ${vid.duration ? `<div class="absolute bottom-2 right-2 bg-black/80 backdrop-blur-md px-1.5 py-0.5 rounded text-[10px] font-bold text-white shadow-sm">${vid.duration}</div>` : ''}
                        </div>
                        <h4 class="font-bold text-white text-sm truncate mb-1 group-hover:text-white transition-colors">${vid.title}</h4>
                        <p class="text-xs text-gray-400 font-medium truncate group-hover:text-gray-300 transition-colors">${vid.channel}</p>
                        ${metaHTML}
                        ${isRemovable ? `<button class="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-red-500/80 rounded-full opacity-0 group-hover:opacity-100 transition-all z-20" onclick="event.stopPropagation(); removeVideo('${vid.videoId}')"><svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>` : ''}
                    `;
                    grid.appendChild(div);
                });
            } else {
                grid.className = "space-y-2";
                videos.forEach(vid => {
                    const div = document.createElement('div');
                    div.className = "flex items-center space-x-4 p-3 rounded-xl hover:bg-[#1a1a1a] cursor-pointer group relative";
                    div.onclick = () => playSearchItem(vid);
                    
                    let metaHTML = '';
                    if (vid.views) metaHTML = `<span class="mx-1">•</span><span>${formatViewCount(vid.views)} views</span><span class="mx-1">•</span><span>${vid.published || ''}</span>`;

                    div.innerHTML = `
                        <div class="relative flex-shrink-0 w-20 h-20 sm:w-24 sm:h-24">
                            <img src="${vid.thumbnail}" class="w-full h-full rounded-lg object-cover">
                            <div class="absolute inset-0 bg-black/40 hidden group-hover:flex items-center justify-center rounded-lg">
                                <svg class="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                            </div>
                        </div>
                        <div class="flex-1 min-w-0">
                            <h4 class="font-semibold text-base truncate text-white mb-1">${vid.title}</h4>
                            <div class="flex items-center text-xs text-gray-400 mt-0.5">
                                <p class="truncate">${vid.channel}</p>
                                ${metaHTML}
                            </div>
                        </div>
                        ${vid.duration ? `<div class="text-xs text-gray-500 font-medium">${vid.duration}</div>` : ''}
                        ${isRemovable ? `<button class="p-2 hover:bg-red-500/20 rounded-full opacity-0 group-hover:opacity-100 transition-all ml-2" onclick="event.stopPropagation(); removeVideo('${vid.videoId}')"><svg class="w-5 h-5 text-gray-400 hover:text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>` : ''}
                    `;
                    grid.appendChild(div);
                });
            }
        }

        function removeVideo(videoId) {
            if(confirm("Remove this song? It won't appear in recommendations again.")) {
                StorageManager.addToBlacklist(videoId);
                renderHomeFeed();
            }
        }

        function renderSearchResults() { renderGenericGrid('results-grid', lastResults); }

        function renderHomeFeed() {
            const section = document.getElementById('content-section');
            const history = StorageManager.getHistory();
            const blacklist = StorageManager.getBlacklist();
            
            const listenAgain = history.plays.filter(p => !blacklist.includes(p.videoId)).slice(0, 18).map(p => ({...p, thumbnail: StorageManager.getThumbnailUrl(p.videoId)}));
            const forYou = FeedGenerator.generate();

            section.innerHTML = `
                <div class="flex items-center justify-between mb-8">
                    <h2 class="text-3xl font-bold tracking-tight">Home</h2>
                    <div class="flex bg-[#212121] rounded-lg p-1">
                        <button id="view-grid-btn" onclick="setViewMode('grid')" class="p-2 rounded-md transition"><svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M4 11h5V5H4v6zm0 7h5v-6H4v6zm6 0h5v-6h-5v6zm6 0h5v-6h-5v6zm-6-7h5V5h-5v6zm6-6v6h5V5h-5z"/></svg></button>
                        <button id="view-list-btn" onclick="setViewMode('list')" class="p-2 rounded-md transition"><svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg></button>
                    </div>
                </div>
                ${listenAgain.length > 0 ? `<div class="mb-10"><div class="flex items-center space-x-2 mb-4"><svg class="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg><h3 class="text-xl font-bold">Listen Again</h3></div><div id="listen-again-grid"></div></div>` : ''}
                <div><div class="flex items-center space-x-2 mb-4"><svg class="w-6 h-6 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"></path></svg><h3 class="text-xl font-bold">For You</h3></div><div id="for-you-grid"></div></div>
            `;
            
            updateViewModeButtons();
            if(listenAgain.length > 0) renderGenericGrid('listen-again-grid', listenAgain, true);
            renderGenericGrid('for-you-grid', forYou, true);
        }

        function renderFavorites() {
            const section = document.getElementById('content-section');
            const favorites = StorageManager.getFavorites();
            section.innerHTML = `<div class="flex items-center justify-between mb-6"><div><h2 class="text-2xl font-bold">Favorites</h2><p class="text-sm text-gray-400 mt-1">${favorites.length} songs</p></div><div class="flex bg-[#212121] rounded-lg p-1"><button id="view-grid-btn" onclick="setViewMode('grid')" class="p-2 rounded-md"><svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M4 11h5V5H4v6zm0 7h5v-6H4v6zm6 0h5v-6h-5v6zm6 0h5v-6h-5v6zm-6-7h5V5h-5v6zm6-6v6h5V5h-5z"/></svg></button><button id="view-list-btn" onclick="setViewMode('list')" class="p-2 rounded-md"><svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg></button></div></div><div id="favorites-grid"></div>`;
            const mappedFavs = favorites.reverse().map(f => ({...f, thumbnail: StorageManager.getThumbnailUrl(f.videoId)}));
            updateViewModeButtons();
            renderGenericGrid('favorites-grid', mappedFavs);
        }

        function renderQueue() {
            const list = document.getElementById('queue-list');
            document.getElementById('queue-count').textContent = `${currentQueue.length} song${currentQueue.length !== 1 ? 's' : ''} in queue`;
            list.innerHTML = '';
            currentQueue.forEach((vid, i) => {
                const el = document.createElement('div');
                const isActive = i === currentIndex;
                el.className = `queue-item group flex items-center space-x-3 p-3 rounded-lg cursor-pointer transition-all ${isActive ? 'active text-white bg-[#212121]' : 'text-gray-300 hover:bg-[#1a1a1a]'}`;
                el.onclick = () => loadTrack(i);
                const thumb = vid.thumbnail || (vid.thumbnails ? vid.thumbnails[0].url : '');
                el.innerHTML = `<div class="w-6 text-center text-xs font-bold text-gray-500">${isActive ? '▶' : i+1}</div><img src="${thumb}" class="w-10 h-10 rounded bg-[#333] object-cover"><div class="flex-1 min-w-0"><p class="text-sm font-semibold truncate">${vid.title}</p><p class="text-xs text-gray-400 truncate">${vid.channel}</p></div><button class="opacity-0 group-hover:opacity-100 p-2 hover:text-red-500" onclick="event.stopPropagation(); removeFromQueue(${i})">x</button>`;
                list.appendChild(el);
            });
            if(fullPlayerMode === 'queue') renderFullPlayerQueue();
        }
        
        function renderFullPlayerQueue() {
            const list = document.getElementById('fp-queue-list');
            list.innerHTML = '';
            currentQueue.forEach((vid, i) => {
                const el = document.createElement('div');
                const isActive = i === currentIndex;
                el.className = `flex items-center space-x-3 p-2 rounded-lg cursor-pointer transition-all ${isActive ? 'bg-white/10' : 'hover:bg-white/5'}`;
                el.onclick = () => loadTrack(i);
                const thumb = vid.thumbnail || (vid.thumbnails ? vid.thumbnails[0].url : '');
                el.innerHTML = `<div class="w-6 text-center text-xs text-gray-400">${isActive ? '▶' : i+1}</div><img src="${thumb}" class="w-10 h-10 rounded bg-[#333] object-cover"><div class="flex-1 min-w-0"><p class="text-sm font-medium truncate ${isActive ? 'text-white' : 'text-gray-300'}">${vid.title}</p><p class="text-xs text-gray-500 truncate">${vid.channel}</p></div>`;
                list.appendChild(el);
            });
        }

        function removeFromQueue(index) {
            if (index === currentIndex) nextTrack(); else if (index < currentIndex) currentIndex--;
            currentQueue.splice(index, 1); renderQueue();
        }
        function setViewMode(mode) {
            viewMode = mode; StorageManager.setViewMode(mode);
            if (currentView === 'home') renderHomeFeed(); 
            else if (currentView === 'favorites') renderFavorites(); 
            else if (currentView === 'search') renderSearchResults();
            else if (currentView === 'top_songs') renderTopSongs();
        }
        function toggleQueue() { document.getElementById('queue-panel').classList.toggle('translate-x-full'); }
        function toggleSettings() { document.getElementById('settings-modal').classList.toggle('hidden'); }
        function setVideoSize(size) { document.getElementById('video-wrapper').style.width = size + 'px'; document.getElementById('size-value').innerText = size + 'px'; }
        function toggleFullPlayer() {
            const overlay = document.getElementById('full-player-overlay'); isFullPlayerOpen = !isFullPlayerOpen;
            if (isFullPlayerOpen) overlay.classList.remove('translate-y-full'); else { overlay.classList.add('translate-y-full'); setFullPlayerMode('art'); }
        }
        
        function setFullPlayerMode(mode) {
            fullPlayerMode = mode; 
            const videoWrapper = document.getElementById('video-wrapper');
            const queueContainer = document.getElementById('fp-queue-container');
            const infoContainer = document.getElementById('fp-info-container');
            const artContainer = document.getElementById('fp-art-container');
            
            // Buttons
            ['art', 'video', 'queue'].forEach(m => {
                const btn = document.getElementById(`fp-mode-${m}`);
                if(m === mode) { btn.classList.add('bg-white/10', 'text-white'); btn.classList.remove('text-gray-400'); }
                else { btn.classList.remove('bg-white/10', 'text-white'); btn.classList.add('text-gray-400'); }
            });

            // Reset States
            videoWrapper.classList.remove('video-wrapper-full');
            if(!isVideoVisible) { videoWrapper.classList.add('video-hidden'); videoWrapper.classList.remove('video-visible'); }
            queueContainer.classList.add('hidden');
            infoContainer.classList.remove('hidden');
            artContainer.classList.remove('hidden');

            if (mode === 'video') {
                videoWrapper.classList.add('video-wrapper-full'); videoWrapper.classList.remove('video-hidden'); videoWrapper.classList.add('video-visible'); isVideoVisible = true;
            } else if (mode === 'queue') {
                queueContainer.classList.remove('hidden');
                infoContainer.classList.add('hidden');
                artContainer.classList.add('hidden');
                renderFullPlayerQueue();
            }
        }
        
        function toggleDesktopSidebar() {
            const sidebar = document.getElementById('sidebar'), settings = StorageManager.getSettings();
            sidebar.classList.toggle('sidebar-collapsed'); settings.sidebarCollapsed = sidebar.classList.contains('sidebar-collapsed');
            StorageManager.saveSettings(settings);
        }

        document.addEventListener('DOMContentLoaded', () => {
            viewMode = StorageManager.getViewMode();
            const savedSettings = StorageManager.getSettings();
            if(savedSettings.sidebarCollapsed) document.getElementById('sidebar').classList.add('sidebar-collapsed');
            document.getElementById('player-size-slider').value = savedSettings.videoSize || 320;
            document.getElementById('incognito-toggle').checked = savedSettings.incognito || false;
            updateIncognitoUI();
            
            // Apply volume
            videoElement.volume = (savedSettings.volume || 100) / 100;
            document.getElementById('volume-slider').value = savedSettings.volume || 100;

            document.getElementById('search-input').addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && e.target.value.trim()) {
                    currentView = 'search'; document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active')); performSearch(e.target.value.trim());
                }
            });

            ['home', 'explore', 'favorites', 'top-songs'].forEach(view => {
                document.getElementById('nav-' + view).onclick = (e) => {
                    e.preventDefault(); currentView = view.replace('-', '_');
                    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active')); document.getElementById('nav-' + view).classList.add('active');
                    if(view === 'home') renderHomeFeed(); 
                    else if(view === 'favorites') renderFavorites();
                    else if(view === 'top-songs') renderTopSongs();
                    else if(view === 'explore') document.getElementById('content-section').innerHTML = '<h2 class="text-2xl font-bold">Explore</h2><p class="text-gray-400">Search for music to get started.</p>';
                    if(window.innerWidth < 640) { document.getElementById('sidebar').classList.add('-translate-x-full'); document.getElementById('sidebar-overlay').classList.add('hidden'); }
                }
            });

            document.getElementById('menu-btn').onclick = () => { document.getElementById('sidebar').classList.remove('-translate-x-full'); document.getElementById('sidebar-overlay').classList.remove('hidden'); };
            const closeSidebar = () => { document.getElementById('sidebar').classList.add('-translate-x-full'); document.getElementById('sidebar-overlay').classList.add('hidden'); };
            document.getElementById('close-sidebar-btn').onclick = closeSidebar; document.getElementById('sidebar-overlay').onclick = closeSidebar;
            document.getElementById('play-pause-btn').onclick = togglePlay; document.getElementById('mobile-play-btn').onclick = togglePlay; document.getElementById('fp-play-btn').onclick = togglePlay;
            document.getElementById('next-btn').onclick = nextTrack; document.getElementById('prev-btn').onclick = prevTrack;
            document.getElementById('mobile-next-btn').onclick = nextTrack; document.getElementById('mobile-prev-btn').onclick = prevTrack; document.getElementById('fp-next-btn').onclick = nextTrack; document.getElementById('fp-prev-btn').onclick = prevTrack;
            
            const seekHandler = (e, id) => seekTo(e, document.getElementById(id));
            document.getElementById('desktop-progress-container').onclick = (e) => seekHandler(e, 'desktop-progress-container');
            document.getElementById('mobile-progress-container').onclick = (e) => seekHandler(e, 'mobile-progress-container');
            document.getElementById('fp-progress-container').onclick = (e) => seekHandler(e, 'fp-progress-container');
            
            document.getElementById('queue-btn').onclick = toggleQueue; document.getElementById('close-queue-btn').onclick = toggleQueue;
            document.getElementById('clear-queue-btn').onclick = () => { currentQueue = []; currentIndex = -1; renderQueue(); };
            document.getElementById('shuffle-queue-btn').onclick = () => { /* Shuffle logic */ };
            const toggleVideoUI = () => {
                isVideoVisible = !isVideoVisible; const wrapper = document.getElementById('video-wrapper'), btn = document.getElementById('toggle-video-btn');
                wrapper.classList.toggle('video-hidden', !isVideoVisible); wrapper.classList.toggle('video-visible', isVideoVisible);
                btn.classList.toggle('text-red-500', isVideoVisible); btn.classList.toggle('border-red-500', isVideoVisible);
            };
            document.getElementById('toggle-video-btn').onclick = toggleVideoUI; document.getElementById('hide-video-btn').onclick = toggleVideoUI;
            const loveHandler = () => { if (currentIndex === -1) return; StorageManager.toggleFavorite(currentQueue[currentIndex]); updateLoveButton(); if (currentView === 'favorites') renderFavorites(); if (currentView === 'home') renderHomeFeed(); };
            document.getElementById('love-btn').onclick = loveHandler; document.getElementById('mobile-love-btn').onclick = loveHandler; document.getElementById('fp-love-btn').onclick = loveHandler;
            document.getElementById('nav-settings').onclick = toggleSettings; document.getElementById('fp-settings-btn').onclick = toggleSettings; document.getElementById('close-settings-btn').onclick = toggleSettings;
            
            // Settings Listeners
            document.getElementById('player-size-slider').oninput = (e) => { setVideoSize(e.target.value); const settings = StorageManager.getSettings(); settings.videoSize = e.target.value; StorageManager.saveSettings(settings); };
            document.getElementById('incognito-toggle').onchange = (e) => {
                const settings = StorageManager.getSettings(); settings.incognito = e.target.checked; StorageManager.saveSettings(settings); updateIncognitoUI();
            };
            document.getElementById('volume-slider').oninput = (e) => {
                const val = e.target.value; videoElement.volume = val / 100; const settings = StorageManager.getSettings(); settings.volume = val; StorageManager.saveSettings(settings);
                document.getElementById('vol-icon').innerHTML = val == 0 ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />' : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />';
            };

            document.getElementById('full-player-btn').onclick = toggleFullPlayer; document.getElementById('close-full-player-btn').onclick = toggleFullPlayer;
            document.getElementById('player-art').onclick = toggleFullPlayer; document.getElementById('player-info-area').onclick = toggleFullPlayer;
            document.getElementById('fp-mode-art').onclick = () => setFullPlayerMode('art'); 
            document.getElementById('fp-mode-video').onclick = () => setFullPlayerMode('video');
            document.getElementById('fp-mode-queue').onclick = () => setFullPlayerMode('queue');
            document.getElementById('desktop-sidebar-toggle').onclick = toggleDesktopSidebar;
            
            const lyricsHandler = toggleLyrics;
            document.getElementById('fp-lyrics-btn').onclick = lyricsHandler;
            document.getElementById('footer-lyrics-btn').onclick = lyricsHandler;
            document.getElementById('close-floating-lyrics-btn').onclick = () => document.getElementById('lyrics-modal').classList.add('hidden');

            // Restore saved view mode
            viewMode = StorageManager.getViewMode();

            // Open as full tab for background play
            document.getElementById('open-tab-btn').onclick = () => {
                chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
            };

            renderHomeFeed();
        });
