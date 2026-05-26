// api.js — внешние API: Shikimori и Google Drive

// Кэш запросов к Shikimori
const SHIKI_CACHE_TTL = 24 * 60 * 60 * 1000;
const _shikiMemCache  = new Map();

function shikiCacheGet(key) {
    if (_shikiMemCache.has(key)) return _shikiMemCache.get(key);
    try {
        const raw = localStorage.getItem('shiki_cache_' + key);
        if (!raw) return null;
        const { ts, data } = JSON.parse(raw);
        if (Date.now() - ts > SHIKI_CACHE_TTL) {
            localStorage.removeItem('shiki_cache_' + key);
            return null;
        }
        _shikiMemCache.set(key, data);
        return data;
    } catch { return null; }
}

function shikiCacheSet(key, data) {
    _shikiMemCache.set(key, data);
    try {
        localStorage.setItem('shiki_cache_' + key, JSON.stringify({ ts: Date.now(), data }));
    } catch {}
}

async function searchShikimoriPosterForSeason(seasonIdx) {
    const inputEl = document.getElementById('shikiSearchInput' + seasonIdx);
    const rawQuery = inputEl?.value.trim()
        || document.getElementById('titleInput')?.value.trim()
        || '';
    if (!rawQuery) return;

    const btn = document.getElementById('shikiSearchBtn' + seasonIdx);
    if (btn) { btn.textContent = '⏳'; btn.disabled = true; }

    const resultsEl = document.getElementById('posterResults' + seasonIdx);
    if (resultsEl) resultsEl.innerHTML = '<span style="font-size:0.8rem;color:var(--text-muted)">Ищем...</span>';

    if (!inputEl || !btn || !resultsEl) {
        console.warn('Элементы поиска не найдены для сезона', seasonIdx);
        return;
    }
    
    try {
        const cacheKey = 'search_' + rawQuery.toLowerCase();
        let results = shikiCacheGet(cacheKey);

        if (!results) {
            const gql = `{
                animes(search: "${rawQuery.replace(/"/g, '\\"')}", limit: 6, order: popularity) {
                    id russian name
                    poster { mainUrl main2xUrl }
                    genres { russian }
                    description
                    episodes episodesAired duration
                    kind
                }
            }`;
            const resp = await fetch('https://shikimori.io/api/graphql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'User-Agent': 'AnimeScorer/1.0' },
                body: JSON.stringify({ query: gql })
            });
            if (!resp.ok) throw new Error('Ошибка ответа: ' + resp.status);
            const json = await resp.json();
            results = json?.data?.animes || [];
            shikiCacheSet(cacheKey, results);
        }

        if (resultsEl) {
            if (!results.length) {
                resultsEl.innerHTML = '<span style="font-size:0.8rem;color:var(--text-muted)">Ничего не найдено.</span>';
                return;
            }
            resultsEl.innerHTML = '';
            results.forEach(anime => {
                const fullUrl  = anime.poster?.main2xUrl || anime.poster?.mainUrl || '';
                const thumbUrl = anime.poster?.mainUrl   || fullUrl;
                if (!fullUrl) return;

                const wrap = document.createElement('div');
                wrap.style.cssText = 'display:inline-block;text-align:center;';

                const img = document.createElement('img');
                img.src          = thumbUrl;
                img.title        = anime.russian || anime.name;
                img.dataset.full = fullUrl;
                img.onclick      = () => selectPosterForSeason(img, fullUrl, seasonIdx, anime);

                const label = document.createElement('div');
                label.style.cssText = 'font-size:0.6rem;color:var(--text-muted);max-width:60px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;margin-top:2px;';
                label.textContent = anime.russian || anime.name;

                wrap.appendChild(img);
                wrap.appendChild(label);
                resultsEl.appendChild(wrap);
            });
        }
    } catch (e) {
        if (resultsEl) resultsEl.innerHTML = `<span style="font-size:0.8rem;color:var(--danger)">Ошибка: ${e.message}</span>`;
    } finally {
        if (btn) { btn.textContent = 'Найти'; btn.disabled = false; }
    }
}

function selectPosterForSeason(imgEl, url, seasonIdx, animeData = null) {
    document.querySelectorAll(`#posterResults${seasonIdx} img`).forEach(i => i.classList.remove('selected'));
    imgEl.classList.add('selected');

    setSeasonPoster(seasonIdx, url);

    if (animeData && seasonIdx === 0) {
        const synopsisEl = document.getElementById('synopsisInput');
        if (synopsisEl && !synopsisEl.value && animeData.description) {
            synopsisEl.value = animeData.description
                .replace(/\[.*?\]/g, '').replace(/\r\n|\n/g, ' ').trim().slice(0, 500);
        }
        const genresEl = document.getElementById('genresInput');
        if (genresEl && !genresEl.value && animeData.genres?.length) {
            genresEl.value = animeData.genres.map(g => g.russian).join(', ');
        }
    }

    if (animeData) {
        const epInput  = document.querySelector(`.season-ep-input[data-season="${seasonIdx}"]`);
        const durInput = document.querySelector(`.season-dur-input[data-season="${seasonIdx}"]`);
        if (epInput && !epInput.value) {
            const ep = animeData.episodes || animeData.episodesAired || '';
            if (ep) { epInput.value = ep; }
        }
        if (durInput && !durInput.value) {
            const dur = animeData.duration || '';
            if (dur) { durInput.value = dur; }
        }
        updateTotalWatchTime();
    }
}

window.searchShikimoriPosterForSeason = searchShikimoriPosterForSeason;

// Google Drive
function openDriveModal() {
    document.getElementById('driveModal').classList.add('active');
    const status = document.getElementById('driveStatus');
    status.className = 'drive-status';
    status.textContent = '';
}

function closeDriveModal() {
    document.getElementById('driveModal').classList.remove('active');
}

function driveSetStatus(msg, type) {
    const el    = document.getElementById('driveStatus');
    el.textContent = msg;
    el.className   = 'drive-status ' + type;
}

async function driveUpload() {
    const token = document.getElementById('driveTokenInput').value.trim();
    if (!token) { driveSetStatus('Вставь Access Token!', 'err'); return; }

    const btn = document.getElementById('driveUploadBtn');
    btn.disabled = true;
    driveSetStatus('Подключаемся к Google Drive...', 'info');

    try {
        const cleanList = animeList.map(a => {
            const copy = { ...a };
            if (copy.poster && copy.poster.startsWith('data:')) copy.poster = '';
            return copy;
        });

        const json     = JSON.stringify(cleanList, null, 2);
        const filename = `anime-scorer_${new Date().toISOString().slice(0, 10)}.json`;

        driveSetStatus('Ищем папку AnimeScorerBackup...', 'info');
        const folderId = await driveFindOrCreateFolder(token, 'AnimeScorerBackup');

        driveSetStatus('Загружаем файл...', 'info');
        await driveCreateFile(token, folderId, filename, json);

        driveSetStatus(`✅ Готово! Файл «${filename}» сохранён в AnimeScorerBackup на Google Drive.`, 'ok');
        localStorage.setItem('lastDriveBackup', Date.now().toString());
        if (typeof hideReminder === 'function') hideReminder();
    } catch (e) {
        driveSetStatus('❌ Ошибка: ' + e.message + '. Токен мог устареть — они живут ~1 час.', 'err');
    } finally {
        btn.disabled = false;
    }
}

async function driveFindOrCreateFolder(token, name) {
    const searchResp = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name)`,
        { headers: { Authorization: 'Bearer ' + token } }
    );
    const searchData = await searchResp.json();
    if (searchData.error) throw new Error(searchData.error.message);
    if (searchData.files?.length) return searchData.files[0].id;

    const createResp = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' })
    });
    const createData = await createResp.json();
    if (createData.error) throw new Error(createData.error.message);
    return createData.id;
}

async function driveCreateFile(token, folderId, filename, content) {
    const metadata = { name: filename, parents: [folderId], mimeType: 'application/json' };
    const blob     = new Blob([content], { type: 'application/json' });
    const form     = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob);

    const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: form
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);
    return data.id;
}

window.openDriveModal  = openDriveModal;
window.closeDriveModal = closeDriveModal;
window.driveUpload     = driveUpload;