// ────────────────────────────────────────────────────────────────
// main.js — основная логика приложения (очищенная версия)
// ────────────────────────────────────────────────────────────────

let animeList = [];
let currentAnimeId = null;

const PAGE_SIZE = 20;
let visibleCount = PAGE_SIZE;
let placeholderCache = {};

const VIBE_MAP = {
    '1.0': 'Нейтрально. Не влияет на оценку.',
    '1.1': 'Слегка понравилось',
    '1.2': 'Симпатия есть',
    '1.3': 'Хорошее впечатление',
    '1.4': 'Довольно понравилось',
    '1.5': 'Выше среднего. Зацепило.',
    '1.6': 'Очень понравилось',
    '1.7': 'Сильное впечатление',
    '1.8': 'Отличное. Однозначно рекомендую.',
    '1.9': 'Почти восторг',
    '2.0': 'Абсолютный восторг. Шедевр для меня.'
};

// ── Инициализация ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    initNavigation();
    initForm();
    initCardSizeToggle();
    initNotesEditor();

    try {
        await initDB();
        animeList = await dbLoadAll();
    } catch (e) {
        console.error('Ошибка инициализации:', e);
        showToast('Ошибка загрузки данных', 'danger', 5000);
        animeList = [];
    }

    renderAnimeList(false);
    renderTop3();
    checkBackupReminder();
});

// ── Навигация ─────────────────────────────────────────────────
let _currentPage = 'home';

function saveListScrollPos() {
    try {
        localStorage.setItem('listScrollY', window.scrollY.toString());
    } catch {}
}

function restoreListScrollPos() {
    try {
        const y = parseInt(localStorage.getItem('listScrollY') || '0');
        if (y > 0) setTimeout(() => window.scrollTo({ top: y, behavior: 'instant' }), 50);
    } catch {}
}

function navigateTo(pageId) {
    // Сохраняем позицию при уходе с "Мой топ"
    if (_currentPage === 'list' && pageId !== 'list') {
        saveListScrollPos();
    }

    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.querySelectorAll('.bottom-nav-item').forEach(l => l.classList.remove('active'));

    const topLink = document.querySelector(`.nav-link[data-page="${pageId}"]`);
    const botLink = document.querySelector(`.bottom-nav-item[data-page="${pageId}"]`);
    if (topLink) topLink.classList.add('active');
    if (botLink) botLink.classList.add('active');

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(pageId + '-page').classList.add('active');

    window.location.hash = pageId;
    _currentPage = pageId;

    if (pageId === 'list') {
        // Восстанавливаем сортировку
        const savedSort = localStorage.getItem('listSortMode');
        if (savedSort) {
            const sel = document.getElementById('sortSelect');
            if (sel) sel.value = savedSort;
        }
        renderAnimeList(false);
        // Восстанавливаем позицию прокрутки
        restoreListScrollPos();
    } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        if (pageId === 'stats') renderStatsPage();
    }
}

function initNavigation() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            navigateTo(link.dataset.page);
        });
    });

    document.querySelectorAll('.bottom-nav-item').forEach(btn => {
        btn.addEventListener('click', () => navigateTo(btn.dataset.page));
    });

    if (window.location.hash) {
        navigateTo(window.location.hash.substring(1));
    }
}

// ── Форма оценки ──────────────────────────────────────────────
const DRAFT_KEY = 'animescorer_draft';
let _draftTimer = null;

function saveDraft() {
    clearTimeout(_draftTimer);
    _draftTimer = setTimeout(() => {
        const draft = {
            title:    document.getElementById('titleInput')?.value || '',
            story:    document.getElementById('storySlider')?.value,
            chars:    document.getElementById('charsSlider')?.value,
            anim:     document.getElementById('animSlider')?.value,
            idea:     document.getElementById('ideaSlider')?.value,
            vibe:     document.getElementById('vibeSlider')?.value,
            notes:    (document.getElementById('notesEditor')?.innerHTML || document.getElementById('notesInput')?.value || ''),
            synopsis: document.getElementById('synopsisInput')?.value || '',
            genres:   document.getElementById('genresInput')?.value || '',
            seasons:  collectSeasons(),
        };
        if (!draft.title && !draft.notes) return;
        try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch {}
    }, 800);
}

function loadDraft() {
    if (currentAnimeId) return;
    try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (!raw) return;
        const d = JSON.parse(raw);
        if (!d.title && !d.notes) return;

        if (d.title) document.getElementById('titleInput').value = d.title;
        ['story','chars','anim','idea'].forEach(k => {
            if (d[k]) {
                document.getElementById(k+'Slider').value      = d[k];
                document.getElementById(k+'Value').textContent = d[k];
            }
        });
        if (d.vibe) {
            document.getElementById('vibeSlider').value        = d.vibe;
            document.getElementById('vibeValue').textContent   = parseFloat(d.vibe).toFixed(1);
            document.getElementById('vibeDescription').textContent = VIBE_MAP[parseFloat(d.vibe).toFixed(1)] || '';
        }
        if (d.notes)    {
            document.getElementById('notesInput').value = d.notes;
            syncNotesInputToEditor(d.notes);
        }
        if (d.synopsis) document.getElementById('synopsisInput').value = d.synopsis;
        if (d.genres)   document.getElementById('genresInput').value   = d.genres;

        if (d.seasons?.length) {
            document.getElementById('seasonsCountInput').value = d.seasons.length;
            renderSeasonsUI(d.seasons.length, d.seasons);
        }
        updateResults();
        showToast('📝 Черновик восстановлен', 'info', 2500);
    } catch {}
}

function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
}

// ── Рендер блоков сезонов ─────────────────────────────────────
function renderSeasonsUI(n, initialData = []) {
    const container = document.getElementById('seasonsContainer');
    if (!container) return;

    const existing = collectSeasons();

    container.innerHTML = '';
    for (let i = 0; i < n; i++) {
        const prev        = initialData[i] || existing[i] || {};
        const epVal       = prev.episodes || '';
        const durVal      = prev.episodeDuration || '';
        const rewatchVal  = prev.rewatchCount || 0;
        const poster      = prev.poster || '';

        const block = document.createElement('div');
        block.className      = 'season-block';
        block.dataset.season = i;
        block.innerHTML = `
            <div class="season-title">
                <span class="season-label">Сезон ${i + 1}</span>
                <div class="season-episodes-row">
                    <input type="number"
                           class="season-ep-input"
                           data-season="${i}"
                           placeholder="серий"
                           min="1" max="9999"
                           value="${epVal}"
                           oninput="updateTotalWatchTime(); saveDraft()">
                    <input type="number"
                           class="season-dur-input"
                           data-season="${i}"
                           placeholder="мин/сер"
                           min="1" max="999"
                           value="${durVal}"
                           title="Длительность одной серии в минутах"
                           oninput="updateTotalWatchTime(); saveDraft()">
                    <span class="season-watch-hint" id="watchHint${i}"></span>
                </div>
                <div class="season-rewatch-row">
                    <span class="season-rewatch-label">🔄</span>
                    <button class="season-rw-btn" onclick="changeSeasonRewatch(${i},-1)" id="rwDec${i}" ${rewatchVal === 0 ? 'disabled' : ''}>−</button>
                    <span class="season-rw-count" id="rwCount${i}">${rewatchVal}</span>
                    <button class="season-rw-btn" onclick="changeSeasonRewatch(${i},1)" id="rwInc${i}">+</button>
                    <span class="season-rw-hint" id="rwHint${i}">${rewatchVal > 0 ? `пересмотрено ${rewatchVal}×` : 'не пересматривался'}</span>
                </div>
            </div>

            <div class="season-poster-area">
                <div class="poster-search-hint" style="margin-top:0.5rem;">🔍 Поиск постера на Shikimori:</div>
                <div class="poster-search-row">
                    <input type="text"
                           class="season-shiki-input"
                           id="shikiSearchInput${i}"
                           placeholder="Название (по умолчанию из заголовка)..."
                           value="">
                    <button class="btn-secondary"
                            onclick="searchShikimoriPosterForSeason(${i})"
                            id="shikiSearchBtn${i}">Найти</button>
                </div>
                <div class="poster-results season-poster-results" id="posterResults${i}"></div>

                <div class="season-poster-preview ${poster ? 'has-poster' : ''}"
                     id="seasonPosterWrap${i}"
                     onclick="triggerSeasonPosterUpload(${i})">
                    <div class="upload-placeholder" id="seasonPlaceholder${i}"
                         style="${poster ? 'display:none' : ''}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:28px;height:28px;margin-bottom:0.4rem;opacity:0.4;">
                            <path d="M3 16L10 9L13 12L21 4" stroke-width="2"/>
                            <rect x="3" y="3" width="18" height="18" rx="2" stroke-width="2"/>
                        </svg>
                        <small>Загрузить</small>
                    </div>
                    <img id="seasonPoster${i}"
                         src="${poster}"
                         alt="Постер ${i + 1}"
                         style="${poster ? '' : 'display:none'}">
                    ${poster ? `<button class="season-poster-clear" onclick="clearSeasonPoster(event,${i})">×</button>` : ''}
                </div>
            </div>
        `;
        container.appendChild(block);

        if (epVal) updateSeasonWatchHint(i, parseInt(epVal));
    }

    updateTotalWatchTime();
}

function updateSeasonWatchHint(idx, ep, dur) {
    const el = document.getElementById('watchHint' + idx);
    if (!el) return;
    if (!ep) { el.textContent = ''; return; }
    const minPerEp = dur || 24;
    const mins  = ep * minPerEp;
    const hours = Math.floor(mins / 60);
    const rem   = mins % 60;
    el.textContent = hours ? `≈${hours}ч${rem ? ' ' + rem + 'м' : ''}` : `≈${mins}м`;
}

function updateTotalWatchTime() {
    const epInputs  = document.querySelectorAll('.season-ep-input');
    const durInputs = document.querySelectorAll('.season-dur-input');
    let totalMinutes    = 0;
    let totalEpisodes   = 0;
    let rewatchMinutes  = 0;

    epInputs.forEach((inp, i) => {
        const ep      = parseInt(inp.value) || 0;
        const dur     = parseInt(durInputs[i]?.value) || 24;
        const rwEl    = document.getElementById('rwCount' + i);
        const rewatch = parseInt(rwEl?.textContent) || 0;

        const baseMin = ep * dur;
        totalEpisodes  += ep;
        totalMinutes   += baseMin;
        rewatchMinutes += baseMin * rewatch;
        updateSeasonWatchHint(i, ep, dur);
    });

    const el = document.getElementById('totalWatchTime');
    if (!el) return;
    if (!totalEpisodes) { el.textContent = ''; return; }

    const allMinutes = totalMinutes + rewatchMinutes;
    const hours = Math.floor(allMinutes / 60);
    const rem   = allMinutes % 60;
    const days  = Math.floor(hours / 24);
    const eqEp  = Math.round(allMinutes / 20);

    let txt = `📺 ${totalEpisodes} сер. · `;
    if (days)  txt += `${days} д ${hours % 24} ч`;
    else       txt += `${hours} ч ${rem ? rem + ' мин' : ''}`;
    txt += ` · ≈${eqEp} эп×20м`;
    if (rewatchMinutes > 0) {
        const rwH = Math.floor(rewatchMinutes / 60);
        const rwD = Math.floor(rwH / 24);
        const rwExtra = rwD ? `${rwD}д ${rwH % 24}ч` : `${rwH}ч ${rewatchMinutes % 60 ? (rewatchMinutes % 60) + 'м' : ''}`;
        txt += ` (включая ${rwExtra} повторов)`;
    }
    el.textContent = txt;
}

function applySeasonsCount() {
    const n = Math.max(1, Math.min(20, parseInt(document.getElementById('seasonsCountInput').value) || 1));
    document.getElementById('seasonsCountInput').value = n;
    renderSeasonsUI(n);
    saveDraft();
}

function collectSeasons() {
    const blocks = document.querySelectorAll('.season-block');
    return Array.from(blocks).map(b => {
        const i        = parseInt(b.dataset.season);
        const epInp    = b.querySelector('.season-ep-input');
        const durInp   = b.querySelector('.season-dur-input');
        const rwEl     = document.getElementById('rwCount' + i);
        const imgEl    = document.getElementById('seasonPoster' + i);
        return {
            num:             i + 1,
            episodes:        parseInt(epInp?.value) || 0,
            episodeDuration: parseInt(durInp?.value) || 0,
            rewatchCount:    parseInt(rwEl?.textContent) || 0,
            poster:   (imgEl?.style.display !== 'none' && imgEl?.src && !imgEl.src.endsWith('/')) ? imgEl.src : '',
        };
    });
}

function triggerSeasonPosterUpload(idx) {
    const imgEl = document.getElementById('seasonPoster' + idx);
    if (imgEl && imgEl.style.display !== 'none') return;

    const inp  = document.createElement('input');
    inp.type   = 'file';
    inp.accept = 'image/*';
    inp.onchange = e => {
        const file = e.target.files[0];
        if (!file || !file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) {
            showToast('Нужна картинка до 5 МБ', 'warning', 3000);
            return;
        }
        const reader = new FileReader();
        reader.onload = ev => setSeasonPoster(idx, ev.target.result);
        reader.readAsDataURL(file);
    };
    inp.click();
}

function setSeasonPoster(idx, url) {
    const imgEl       = document.getElementById('seasonPoster' + idx);
    const placeholder = document.getElementById('seasonPlaceholder' + idx);
    const wrap        = document.getElementById('seasonPosterWrap' + idx);
    if (!imgEl) return;

    imgEl.src           = url;
    imgEl.style.display = '';
    if (placeholder) placeholder.style.display = 'none';

    let clearBtn = wrap.querySelector('.season-poster-clear');
    if (!clearBtn) {
        clearBtn = document.createElement('button');
        clearBtn.className = 'season-poster-clear';
        clearBtn.textContent = '×';
        clearBtn.onclick = ev => clearSeasonPoster(ev, idx);
        wrap.appendChild(clearBtn);
    }
    saveDraft();
}

function clearSeasonPoster(event, idx) {
    event.stopPropagation();
    const imgEl       = document.getElementById('seasonPoster' + idx);
    const placeholder = document.getElementById('seasonPlaceholder' + idx);
    const wrap        = document.getElementById('seasonPosterWrap' + idx);
    if (imgEl)       { imgEl.src = ''; imgEl.style.display = 'none'; }
    if (placeholder)   placeholder.style.display = '';
    wrap?.querySelector('.season-poster-clear')?.remove();
    saveDraft();
}

window.applySeasonsCount         = applySeasonsCount;
window.triggerSeasonPosterUpload = triggerSeasonPosterUpload;
window.clearSeasonPoster         = clearSeasonPoster;

function changeSeasonRewatch(idx, delta) {
    const countEl = document.getElementById('rwCount' + idx);
    const hintEl  = document.getElementById('rwHint'  + idx);
    const decBtn  = document.getElementById('rwDec'   + idx);
    if (!countEl) return;

    const cur     = parseInt(countEl.textContent) || 0;
    const next    = Math.max(0, cur + delta);
    countEl.textContent  = next;
    if (decBtn) decBtn.disabled = next === 0;
    if (hintEl) hintEl.textContent = next > 0 ? `пересмотрено ${next}×` : 'не пересматривался';

    updateTotalWatchTime();
    saveDraft();
}
window.changeSeasonRewatch = changeSeasonRewatch;

function initForm() {
    // Слайдеры
    ['story', 'chars', 'anim', 'idea'].forEach(key => {
        const slider  = document.getElementById(key + 'Slider');
        const valueEl = document.getElementById(key + 'Value');
        slider.addEventListener('input', () => {
            valueEl.textContent = slider.value;
            updateResults();
            saveDraft();
        });
    });

    const vibeSlider = document.getElementById('vibeSlider');
    const vibeValue  = document.getElementById('vibeValue');
    const vibeDesc   = document.getElementById('vibeDescription');
    vibeSlider.addEventListener('input', () => {
        const val       = parseFloat(vibeSlider.value).toFixed(1);
        vibeValue.textContent = val;
        vibeDesc.textContent  = VIBE_MAP[val] || 'Нейтрально';
        updateResults();
        saveDraft();
    });

    // Постер
    const posterArea = document.getElementById('posterUpload');
    const posterImg  = document.getElementById('posterPreview');
    posterArea.onclick = () => {
        const inp  = document.createElement('input');
        inp.type   = 'file';
        inp.accept = 'image/*';
        inp.onchange = e => handleImageUpload(e.target.files[0]);
        inp.click();
    };
    posterArea.ondragover  = e => { e.preventDefault(); posterArea.style.borderColor = 'var(--accent)'; };
    posterArea.ondragleave = () => (posterArea.style.borderColor = 'var(--border)');
    posterArea.ondrop      = e => {
        e.preventDefault();
        posterArea.style.borderColor = 'var(--border)';
        handleImageUpload(e.dataTransfer.files[0]);
    };
    function handleImageUpload(file) {
        if (!file || !file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) {
            showToast('Нужна картинка до 5 МБ', 'warning', 3000);
            return;
        }
        const reader  = new FileReader();
        reader.onload = ev => {
            posterImg.src          = ev.target.result;
            posterImg.style.display = 'block';
            posterArea.querySelector('.upload-placeholder').style.display = 'none';
        };
        reader.readAsDataURL(file);
    }

    // Автосохранение
    ['titleInput','synopsisInput','genresInput'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', saveDraft);
    });

    renderSeasonsUI(1);

    document.getElementById('saveBtn').onclick = saveAnime;

    document.getElementById('sortSelect').onchange   = () => {
        visibleCount = PAGE_SIZE;
        try { localStorage.setItem('listSortMode', document.getElementById('sortSelect').value); } catch {}
        renderAnimeList(false);
    };
    document.getElementById('searchInput').oninput   = () => { visibleCount = PAGE_SIZE; renderAnimeList(false); };

    document.getElementById('importBtn').onclick      = importData;
    document.getElementById('exportBtn').onclick      = exportData;
    document.getElementById('clearAllBtn').onclick    = confirmClearAll;
    document.getElementById('driveBackupBtn').onclick = openDriveModal;

    const titleInput = document.getElementById('titleInput');
    if (titleInput) {
        titleInput.addEventListener('input', () => {
            const shikiInput0 = document.getElementById('shikiSearchInput0');
            if (shikiInput0) shikiInput0.value = titleInput.value;
        });
    }

    document.getElementById('modalConfirmBtn').onclick = handleModalConfirm;

    updateResults();
    loadDraft();
}

function updateResults() {
    const vals  = ['story', 'chars', 'anim', 'idea'].map(k => +document.getElementById(k + 'Slider').value);
    const avg   = vals.reduce((a, b) => a + b, 0) / 4;
    const vibe  = +document.getElementById('vibeSlider').value;
    const final = Math.min(avg * vibe, 10);

    document.getElementById('avgScore').textContent   = avg.toFixed(1);
    document.getElementById('baseScore').textContent  = avg.toFixed(1);
    document.getElementById('finalScore').textContent = final.toFixed(1);
    document.getElementById('finalPercent').textContent = (final * 10).toFixed(1) + '%';

    ['Story', 'Chars', 'Anim', 'Idea'].forEach((k, i) => {
        document.getElementById('detail' + k).textContent = vals[i];
    });
}

async function saveAnime() {
    const title = document.getElementById('titleInput').value.trim();
    if (!title) return showToast('Введите название аниме', 'warning', 3000);

    const dup = findDuplicate(title, currentAnimeId);
    if (dup) {
        const ok = confirm(`«${dup.title}» уже есть в списке (оценка ${dup.finalScore.toFixed(1)}). Всё равно добавить?`);
        if (!ok) return;
    }

    const seasons = collectSeasons();
    const mainPoster    = seasons.find(s => s.poster)?.poster || '';
    const totalEpisodes = seasons.reduce((s, x) => s + (x.episodes || 0), 0);
    const totalMinutes  = seasons.reduce((s, x) => {
        const dur = x.episodeDuration || 24;
        return s + (x.episodes || 0) * dur;
    }, 0);
    // Суммарные пересмотры по сезонам
    const rewatchCount = seasons.reduce((s, x) => s + (x.rewatchCount || 0), 0);

    const anime = {
        id: currentAnimeId || Date.now().toString(),
        title,
        poster: mainPoster,
        seasons,
        episodes: totalEpisodes,
        totalMinutes,
        rewatchCount,
        story:     +document.getElementById('storySlider').value,
        chars:     +document.getElementById('charsSlider').value,
        anim:      +document.getElementById('animSlider').value,
        idea:      +document.getElementById('ideaSlider').value,
        vibe:      +document.getElementById('vibeSlider').value,
        notes:     (document.getElementById('notesEditor')?.innerHTML || document.getElementById('notesInput')?.value || '').trim(),
        synopsis:  document.getElementById('synopsisInput')?.value.trim() || '',
        genres:    document.getElementById('genresInput')?.value.trim() || '',
        createdAt: currentAnimeId ? getAnimeById(currentAnimeId)?.createdAt : Date.now(),
        updatedAt: Date.now()
    };

    const avg = (anime.story + anime.chars + anime.anim + anime.idea) / 4;
    anime.avgScore   = avg;
    anime.finalScore = Math.min(avg * anime.vibe, 10);

    const idx = animeList.findIndex(a => a.id === anime.id);
    if (idx > -1) animeList[idx] = anime;
    else          animeList.push(anime);

    try {
        await dbSaveAll(animeList);
        resetForm();
        renderTop3();
        checkInflation();
        navigateTo('list');
    } catch (e) {
        console.error('Ошибка сохранения:', e);
        showToast('Ошибка при сохранении в БД', 'danger', 4000);
    }
}

// Сброс формы (без анимаций и конфетти)
function resetForm() {
    document.getElementById('titleInput').value = '';

    const notesEl = document.getElementById('notesInput');
    const synopsisEl = document.getElementById('synopsisInput');
    const genresEl = document.getElementById('genresInput');
    const posterImg = document.getElementById('posterPreview');
    posterImg.src = '';
    posterImg.style.display = 'none';
    const uploadPlaceholder = document.querySelector('#posterUpload .upload-placeholder');
    if (uploadPlaceholder) uploadPlaceholder.style.display = '';
    if (notesEl) { notesEl.value = ''; syncNotesInputToEditor(''); }
    if (synopsisEl) synopsisEl.value = '';
    if (genresEl) genresEl.value = '';

    document.getElementById('seasonsCountInput').value = 1;
    renderSeasonsUI(1);

    ['story', 'chars', 'anim', 'idea'].forEach(k => {
        document.getElementById(k + 'Slider').value = 5;
        document.getElementById(k + 'Value').textContent = '5';
    });

    document.getElementById('vibeSlider').value = 1.0;
    document.getElementById('vibeValue').textContent = '1.0';
    document.getElementById('vibeDescription').textContent = 'Нейтрально. Не влияет на оценку.';

    currentAnimeId = null;
    clearDraft();
    updateResults();
}

// ── Список аниме ──────────────────────────────────────────────
function renderAnimeList(append = false) {
    const container = document.getElementById('animeList');
    if (!container) return;

    if (!append) container.innerHTML = '<div class="loading">Загрузка списка...</div>';

    setTimeout(() => {
        let filtered = [...animeList];

        const query = document.getElementById('searchInput')?.value?.trim().toLowerCase() || '';
        if (query) filtered = filtered.filter(a => a.title.toLowerCase().includes(query));

        const sortMode = document.getElementById('sortSelect')?.value || 'final_desc';
        filtered.sort((a, b) => {
            switch (sortMode) {
                case 'final_desc': return b.finalScore - a.finalScore;
                case 'final_asc':  return a.finalScore - b.finalScore;
                case 'avg_desc':   return b.avgScore   - a.avgScore;
                case 'avg_asc':    return a.avgScore   - b.avgScore;
                case 'date_desc':  return b.createdAt  - a.createdAt;
                case 'date_asc':   return a.createdAt  - b.createdAt;
                default:           return 0;
            }
        });

        const start = append ? visibleCount - PAGE_SIZE : 0;
        const slice = filtered.slice(start, visibleCount);

        const html = slice.map(anime => `
            <div class="anime-card${anime.bookmark ? ' has-bookmark bookmark-' + anime.bookmark : ''}" data-id="${anime.id}">
                <img src="${anime.poster || getPlaceholderImage(anime.title)}"
                     alt="${anime.title}"
                     class="anime-poster"
                     onerror="this.src='${getPlaceholderImage(anime.title)}'">
                <div class="gallery-overlay">
                    <div class="gallery-title">${escapeHtml(anime.title)}</div>
                    <div class="gallery-score">${anime.finalScore.toFixed(1)}</div>
                </div>
                <div class="anime-info">
                    <div class="anime-header">
                        <div class="anime-title">${escapeHtml(anime.title)}</div>
                        <div class="anime-score">${anime.finalScore.toFixed(1)}</div>
                    </div>
                    <div class="bookmark-row">
                        <button class="bookmark-btn${anime.bookmark === 'rescore' ? ' active' : ''}" onclick="toggleBookmark('${anime.id}','rescore')" title="Пересмотреть оценку">
                            🔁 <span>Пересмотреть оценку</span>
                        </button>
                        <button class="bookmark-btn${anime.bookmark === 'rewatch' ? ' active' : ''}" onclick="toggleBookmark('${anime.id}','rewatch')" title="Пересмотреть для уточнения">
                            👁️ <span>Пересмотреть</span>
                        </button>
                        <button class="bookmark-btn${anime.bookmark === 'essay' ? ' active' : ''}" onclick="toggleBookmark('${anime.id}','essay')" title="Написать эссе / отзыв">
                            ✍️ <span>Написать эссе</span>
                        </button>
                    </div>
                    <div class="anime-details">
                        <div>Добавлено: ${new Date(anime.createdAt).toLocaleDateString()}</div>
                        <div>Среднее: ${anime.avgScore.toFixed(1)} × Вайб: ${anime.vibe.toFixed(1)}</div>
                    </div>
                    <div class="anime-criteria">
                        <div class="criteria-item"><span class="criteria-name">Сюжет:</span><span class="criteria-value">${anime.story}/10</span></div>
                        <div class="criteria-item"><span class="criteria-name">Персонажи:</span><span class="criteria-value">${anime.chars}/10</span></div>
                        <div class="criteria-item"><span class="criteria-name">Анимация:</span><span class="criteria-value">${anime.anim}/10</span></div>
                        <div class="criteria-item"><span class="criteria-name">Идея:</span><span class="criteria-value">${anime.idea}/10</span></div>
                        <div class="criteria-item"><span class="criteria-name">Вайб:</span><span class="criteria-value">${anime.vibe.toFixed(1)}</span></div>
                        <div class="criteria-item"><span class="criteria-name">Среднее:</span><span class="criteria-value">${anime.avgScore.toFixed(1)}</span></div>
                    </div>
                    ${buildRadarSVG(anime)}
                    ${anime.genres ? `<div class="anime-genres">${escapeHtml(anime.genres)}</div>` : ''}
                    ${(() => {
                        if (!anime.episodes) return '';
                        const seasons = anime.seasons?.length || 1;
                        const mins  = anime.totalMinutes || anime.episodes * 24;
                        const hours = Math.floor(mins / 60);
                        const days  = Math.floor(hours / 24);
                        const eqEp  = Math.round(mins / 20);
                        const timeStr = days
                            ? `${days}д ${hours % 24}ч`
                            : hours ? `~${hours}ч` : `~${mins}м`;
                        return `<div class="anime-episodes">📺 ${anime.episodes} сер. · ${seasons > 1 ? seasons + ' сез. · ' : ''}${timeStr} · ≈${eqEp} эп×20м</div>`;
                    })()}
                    ${(anime.rewatchCount || 0) > 0 ? `<div class="anime-rewatched">🔄 Пересмотрено: ${anime.rewatchCount} раз</div>` : ''}
                    <div class="action-buttons">
                        <button class="btn-secondary" onclick="editAnime('${anime.id}')">
                            <svg class="icon" viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                            <span class="btn-text">Редактировать</span>
                        </button>
                        <button class="btn-danger" onclick="confirmDelete('${anime.id}')">
                            <svg class="icon" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                            <span class="btn-text">Удалить</span>
                        </button>
                    </div>
                </div>
            </div>
        `).join('');

        if (append) {
            container.insertAdjacentHTML('beforeend', html);
        } else {
            container.innerHTML = html || `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path d="M9 12L11 14L15 10M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke-width="2"/>
                    </svg>
                    <p>${query ? 'Ничего не найдено' : 'Ваш список пока пуст'}</p>
                    ${!query ? '<p class="text-muted">Начните с добавления первой оценки на странице "Оценить"</p>' : ''}
                </div>
            `;
        }

        updateStats(filtered);

        const more = document.getElementById('loadMoreContainer');
        more.innerHTML = '';
        if (visibleCount < filtered.length) {
            const btn       = document.createElement('button');
            btn.className   = 'load-more-btn';
            btn.textContent = `Загрузить ещё (${visibleCount} из ${filtered.length})`;
            btn.onclick     = () => { visibleCount += PAGE_SIZE; renderAnimeList(true); };
            more.appendChild(btn);
        }
    }, 0);
}

function calculateTotalWatchTime() {
    let totalEpisodes   = 0;
    let totalMinutes    = 0;
    let rewatchMinutes  = 0;

    animeList.forEach(a => {
        totalEpisodes += a.episodes || 0;
        const baseMin  = a.totalMinutes || (a.episodes || 0) * 24;
        totalMinutes  += baseMin;

        // Считаем реальные минуты пересмотров по сезонам (если есть детализация)
        if (a.seasons?.length) {
            a.seasons.forEach(s => {
                const dur = s.episodeDuration || 24;
                rewatchMinutes += (s.episodes || 0) * dur * (s.rewatchCount || 0);
            });
        } else {
            // fallback: общий rewatchCount без деления по сезонам
            rewatchMinutes += baseMin * (a.rewatchCount || 0);
        }
    });

    const allMinutes     = totalMinutes + rewatchMinutes;
    const hours          = Math.floor(allMinutes / 60);
    const days           = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    const minutes        = allMinutes % 60;
    const eqEpisodes     = Math.round(allMinutes / 20);

    return { totalEpisodes, totalMinutes, rewatchMinutes, allMinutes, days, hours, remainingHours, minutes, eqEpisodes };
}

function updateStats(filtered) {
    const el = document.getElementById('statsRow');
    if (!el) return;
    const list = filtered || animeList;
    if (!list.length) { el.innerHTML = ''; return; }

    const total = list.length;
    const avg = list.reduce((s, a) => s + a.finalScore, 0) / total;
    const best = list.reduce((b, a) => a.finalScore > b.finalScore ? a : b);
    const byVibe = [...list].sort((a, b) => b.vibe - a.vibe)[0];

    const watchTime = calculateTotalWatchTime();
    let timeStr = '';
    const ref = watchTime.allMinutes;
    const h = Math.floor(ref / 60), d = Math.floor(h / 24);
    if (d > 0)      timeStr = `${d} д ${h % 24} ч`;
    else if (h > 0) timeStr = `${h} ч ${ref % 60} м`;
    else            timeStr = `${ref} м`;

    const totalRewatches = list.reduce((s, a) => s + (a.rewatchCount || 0), 0);

    el.innerHTML = `
        <div class="stat-pill">🎬 Всего <strong>${total}</strong></div>
        <div class="stat-pill">⭐ Средняя <strong>${avg.toFixed(2)}</strong></div>
        <div class="stat-pill">🏆 Топ: <strong title="${escapeHtml(best.title)}">${escapeHtml(best.title.length > 18 ? best.title.slice(0, 16) + '…' : best.title)}</strong> ${best.finalScore.toFixed(1)}</div>
        <div class="stat-pill">💜 Вайб: <strong title="${escapeHtml(byVibe.title)}">${escapeHtml(byVibe.title.length > 18 ? byVibe.title.slice(0, 16) + '…' : byVibe.title)}</strong> ×${byVibe.vibe.toFixed(1)}</div>
        <div class="stat-pill">⏱️ Всего: <strong>${watchTime.eqEpisodes} эп×20м</strong> (${timeStr})${totalRewatches > 0 ? ' 🔄' : ''}</div>
        ${totalRewatches > 0 ? `<div class="stat-pill">🔄 Пересмотров: <strong>${totalRewatches}</strong></div>` : ''}
    `;
}

// ── CRUD ──────────────────────────────────────────────────────
function getAnimeById(id) {
    return animeList.find(a => a.id === id);
}

function editAnime(id) {
    const anime = getAnimeById(id);
    if (!anime) return;

    document.getElementById('titleInput').value = anime.title;
    if (anime.poster) {
        const posterImg = document.getElementById('posterPreview');
        posterImg.src          = anime.poster;
        posterImg.style.display = 'block';
        document.getElementById('posterUpload').querySelector('.upload-placeholder').style.display = 'none';
    }

    ['story', 'chars', 'anim', 'idea'].forEach(k => {
        document.getElementById(k + 'Slider').value    = anime[k];
        document.getElementById(k + 'Value').textContent = anime[k];
    });

    document.getElementById('vibeSlider').value        = anime.vibe;
    document.getElementById('vibeValue').textContent   = anime.vibe.toFixed(1);
    document.getElementById('vibeDescription').textContent = getVibeDescription(anime.vibe);

    const notesEl    = document.getElementById('notesInput');
    const synopsisEl = document.getElementById('synopsisInput');
    const genresEl   = document.getElementById('genresInput');
    if (notesEl)    { notesEl.value    = anime.notes    || ''; syncNotesInputToEditor(anime.notes || ''); }
    if (synopsisEl) synopsisEl.value = anime.synopsis || '';
    if (genresEl)   genresEl.value   = anime.genres   || '';

    const seasons = anime.seasons?.length
        ? anime.seasons
        : [{ num: 1, episodes: anime.episodes || 0, episodeDuration: 0, poster: anime.poster || '' }];
    document.getElementById('seasonsCountInput').value = seasons.length;
    renderSeasonsUI(seasons.length, seasons);

    currentAnimeId = anime.id;
    updateResults();
    navigateTo('home');
}

function getVibeDescription(v) {
    return VIBE_MAP[v.toFixed(1)] || 'Нейтрально';
}

function confirmDelete(id) {
    const anime = getAnimeById(id);
    if (!anime) return;
    openModal(`Удалить «${anime.title}»?`, async () => {
        animeList = animeList.filter(a => a.id !== id);
        await dbSaveAll(animeList);
        visibleCount = PAGE_SIZE;
        renderAnimeList(false);
    });
}

function confirmClearAll() {
    if (!animeList.length) return;
    openModal('Удалить ВСЕ записи? Это необратимо.', async () => {
        animeList = [];
        await dbSaveAll(animeList);
        visibleCount = PAGE_SIZE;
        renderAnimeList(false);
    });
}

// ── Закладки ──────────────────────────────────────────────────
const BOOKMARK_LABELS = {
    rescore: '🔁 Пересмотреть оценку',
    rewatch: '👁️ Пересмотреть',
    essay:   '✍️ Написать эссе',
};

async function toggleBookmark(id, type) {
    const anime = getAnimeById(id);
    if (!anime) return;
    anime.bookmark = anime.bookmark === type ? null : type;
    await dbSaveAll(animeList);
    renderAnimeList(false);
    if (anime.bookmark) {
        showToast(`Закладка: ${BOOKMARK_LABELS[type]}`, 'info', 2000);
    }
}

window.toggleBookmark = toggleBookmark;

// ── Импорт / Экспорт ──────────────────────────────────────────
function exportData() {
    const json = JSON.stringify(animeList, null, 2);
    const uri  = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
    const a    = document.createElement('a');
    a.href     = uri;
    a.download = `anime-scorer_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
}

function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);
            if (!Array.isArray(data)) throw new Error('Файл должен содержать массив объектов');
            const requiredFields = ['id', 'title', 'story', 'chars', 'anim', 'idea', 'vibe', 'avgScore', 'finalScore', 'createdAt'];
            const validData = data.filter(item => requiredFields.every(field => field in item) && typeof item.title === 'string' && !isNaN(Number(item.finalScore)));
            if (validData.length === 0) throw new Error('Не найдено валидных записей');
            if (validData.length < data.length) showToast(`Импортировано ${validData.length} из ${data.length} записей`, 'warning', 4000);
            openModal(`Заменить текущие ${animeList.length} записей на ${validData.length} из файла?`, async () => {
                animeList = validData;
                await dbSaveAll(animeList);
                visibleCount = PAGE_SIZE;
                renderAnimeList(false);
                renderTop3();
                showToast('Импорт успешно завершён', 'success', 3000);
            });
        } catch (err) {
            alert('Ошибка импорта: ' + err.message);
        }
    };
    input.click();
}

// ── Модалка подтверждения ─────────────────────────────────────
let modalCb = null;

function openModal(text, cb) {
    document.getElementById('modalMessage').textContent = text;
    modalCb = cb;
    document.getElementById('confirmModal').classList.add('active');
}

function closeModal() {
    document.getElementById('confirmModal').classList.remove('active');
    modalCb = null;
}

function handleModalConfirm() {
    if (modalCb) modalCb();
    closeModal();
}

// ── Напоминание о бэкапе ──────────────────────────────────────
const BACKUP_REMIND_DAYS = 7;

function checkBackupReminder() {
    const last      = parseInt(localStorage.getItem('lastDriveBackup')          || '0');
    const dismissed = parseInt(localStorage.getItem('backupReminderDismissed') || '0');
    const now       = Date.now();
    const dayMs     = 86_400_000;

    if (dismissed && (now - dismissed) < dayMs) return;

    const el     = document.getElementById('backupReminder');
    const textEl = document.getElementById('backupReminderText');
    if (!el) return;

    if (last === 0) {
        if (animeList.length >= 3) {
            textEl.textContent = `У тебя уже ${animeList.length} аниме — самое время сделать первый бэкап на Google Drive 🙂`;
            el.classList.add('visible');
        }
    } else {
        const daysPassed = Math.floor((now - last) / dayMs);
        if (daysPassed >= BACKUP_REMIND_DAYS) {
            textEl.textContent = `Последний бэкап на Google Drive был ${daysPassed} ${pluralDays(daysPassed)} назад. Не забудь обновить!`;
            el.classList.add('visible');
        }
    }
}

function dismissReminder() {
    localStorage.setItem('backupReminderDismissed', Date.now().toString());
    hideReminder();
}

function hideReminder() {
    document.getElementById('backupReminder')?.classList.remove('visible');
}

function pluralDays(n) {
    if (n % 10 === 1 && n % 100 !== 11) return 'день';
    if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'дня';
    return 'дней';
}

// ── Утилиты ───────────────────────────────────────────────────
function escapeHtml(str) {
    const div      = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function getPlaceholderImage(title) {
    if (placeholderCache[title]) return placeholderCache[title];

    const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'];
    const c      = colors[title.length % colors.length];
    const cv     = document.createElement('canvas');
    cv.width = 300; cv.height = 180;
    const ctx = cv.getContext('2d');

    const gr = ctx.createLinearGradient(0, 0, 300, 180);
    gr.addColorStop(0, c + '40');
    gr.addColorStop(1, c + '20');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, 300, 180);

    ctx.fillStyle    = c + '80';
    ctx.font         = 'bold 16px sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    const short = title.length > 20 ? title.slice(0, 17) + '...' : title;
    ctx.fillText(short, 150, 90);

    const url = cv.toDataURL();
    placeholderCache[title] = url;
    return url;
}

document.addEventListener('click', e => {
    if (e.target.id === 'driveModal')   closeDriveModal();
    if (e.target.id === 'confirmModal') closeModal();
});
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); closeDriveModal(); }
});

// ── Топ-3 виджет ──────────────────────────────────────────────
function renderTop3() {
    const container = document.getElementById('top3List');
    if (!container) return;
    if (animeList.length === 0) {
        container.closest('.top3-widget').style.display = 'none';
        return;
    }
    container.closest('.top3-widget').style.display = '';

    const top3 = [...animeList]
        .sort((a, b) => b.avgScore - a.avgScore)
        .slice(0, 3);

    const rankClass = ['gold', 'silver', 'bronze'];
    const rankEmoji = ['🥇', '🥈', '🥉'];

    container.innerHTML = top3.map((anime, i) => `
        <div class="top3-item" onclick="editAnime('${anime.id}')">
            <div class="top3-rank ${rankClass[i]}">${rankEmoji[i]}</div>
            <img class="top3-poster"
                 src="${anime.poster || getPlaceholderImage(anime.title)}"
                 onerror="this.src='${getPlaceholderImage(anime.title)}'">
            <div class="top3-info">
                <div class="top3-title">${escapeHtml(anime.title)}</div>
                <div class="top3-score">${anime.finalScore.toFixed(1)}</div>
            </div>
        </div>
    `).join('');
}

// ── Радарная диаграмма ───────────────────────────────────────
function buildRadarSVG(anime) {
    const size   = 80;
    const cx     = size / 2, cy = size / 2;
    const r      = 30;
    const labels = ['С', 'П', 'А', 'И'];
    const vals   = [anime.story, anime.chars, anime.anim, anime.idea];
    const n      = vals.length;
    const angles = vals.map((_, i) => (i / n) * Math.PI * 2 - Math.PI / 2);

    let bg = '';
    [0.25, 0.5, 0.75, 1].forEach(frac => {
        const pts = angles.map(a =>
            `${cx + r * frac * Math.cos(a)},${cy + r * frac * Math.sin(a)}`
        ).join(' ');
        bg += `<polygon points="${pts}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="0.5"/>`;
    });

    let axes = '';
    angles.forEach((a, i) => {
        axes += `<line x1="${cx}" y1="${cy}" x2="${cx + r * Math.cos(a)}" y2="${cy + r * Math.sin(a)}" stroke="rgba(255,255,255,0.15)" stroke-width="0.5"/>`;
        const lx = cx + (r + 6) * Math.cos(a);
        const ly = cy + (r + 6) * Math.sin(a);
        axes += `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="6" fill="rgba(255,255,255,0.5)">${labels[i]}</text>`;
    });

    const pts = vals.map((v, i) => {
        const frac = v / 10;
        return `${cx + r * frac * Math.cos(angles[i])},${cy + r * frac * Math.sin(angles[i])}`;
    }).join(' ');

    return `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" class="radar-svg">
        ${bg}${axes}
        <polygon points="${pts}" fill="var(--accent)" fill-opacity="0.25" stroke="var(--accent)" stroke-width="1"/>
    </svg>`;
}

function buildDistributionRadar(counts, maxCount) {
    const size = 200;
    const cx = size / 2, cy = size / 2;
    const r = 80;
    const n = counts.length;
    const angles = Array.from({ length: n }, (_, i) => (i / n) * Math.PI * 2 - Math.PI / 2);

    let bg = '';
    [0.25, 0.5, 0.75, 1].forEach(frac => {
        const pts = angles.map(a => `${cx + r * frac * Math.cos(a)},${cy + r * frac * Math.sin(a)}`).join(' ');
        bg += `<polygon points="${pts}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>`;
    });

    let axes = '';
    const labels = Array.from({ length: n }, (_, i) => (i + 1).toString());
    angles.forEach((a, i) => {
        axes += `<line x1="${cx}" y1="${cy}" x2="${cx + r * Math.cos(a)}" y2="${cy + r * Math.sin(a)}" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>`;
        const lx = cx + (r + 18) * Math.cos(a);
        const ly = cy + (r + 18) * Math.sin(a);
        axes += `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="8" fill="rgba(255,255,255,0.6)">${labels[i]}</text>`;
    });

    const pts = counts.map((cnt, i) => {
        const frac = maxCount ? cnt / maxCount : 0;
        return `${cx + r * frac * Math.cos(angles[i])},${cy + r * frac * Math.sin(angles[i])}`;
    }).join(' ');

    const points = counts.map((cnt, i) => {
        const frac = maxCount ? cnt / maxCount : 0;
        const x = cx + r * frac * Math.cos(angles[i]);
        const y = cy + r * frac * Math.sin(angles[i]);
        return `<circle cx="${x}" cy="${y}" r="4" fill="var(--accent)" />`;
    }).join('');

    return `
        <svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" class="distribution-svg">
            ${bg}${axes}
            <polygon points="${pts}" fill="var(--accent)" fill-opacity="0.25" stroke="var(--accent)" stroke-width="2"/>
            ${points}
        </svg>
    `;
}

function renderStatsPage() {
    const container = document.getElementById('statsContent');
    if (!container) return;

    if (animeList.length === 0) {
        container.innerHTML = '<p class="empty-state">Нет данных для статистики</p>';
        return;
    }

    const total = animeList.length;
    const totalEpisodes  = animeList.reduce((sum, a) => sum + (a.episodes || 0), 0);
    const wt             = calculateTotalWatchTime();
    const allMinutes     = wt.allMinutes;
    const hours          = Math.floor(allMinutes / 60);
    const days           = Math.floor(hours / 24);
    const remHours       = hours % 24;
    const mins           = allMinutes % 60;
    const timeStr        = days ? `${days}д ${remHours}ч` : (hours ? `${hours}ч ${mins}м` : `${mins}м`);
    const eqEpisodes     = wt.eqEpisodes;
    const totalRewatches = animeList.reduce((s, a) => s + (a.rewatchCount || 0), 0);

    const avgFinal = (animeList.reduce((s, a) => s + a.finalScore, 0) / total).toFixed(2);
    const avgAvg = (animeList.reduce((s, a) => s + a.avgScore, 0) / total).toFixed(2);

    const categories = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
    const countsFinal = Array(10).fill(0);
    animeList.forEach(a => {
        let idx = Math.floor(a.finalScore) - 1;
        if (idx < 0) idx = 0;
        if (idx > 9) idx = 9;
        countsFinal[idx]++;
    });
    const maxCountFinal = Math.max(...countsFinal);

    const countsAvg = Array(10).fill(0);
    animeList.forEach(a => {
        let idx = Math.floor(a.avgScore) - 1;
        if (idx < 0) idx = 0;
        if (idx > 9) idx = 9;
        countsAvg[idx]++;
    });
    const maxCountAvg = Math.max(...countsAvg);

    const radarFinalSvg = buildDistributionRadar(countsFinal, maxCountFinal);
    const radarAvgSvg = buildDistributionRadar(countsAvg, maxCountAvg);

    const top3 = [...animeList].sort((a, b) => b.avgScore - a.avgScore).slice(0, 3);
    const medalColors = ['#FFD700', '#C0C0C0', '#CD7F32'];
    const medalNames = ['🥇 Золото', '🥈 Серебро', '🥉 Бронза'];

    const genreCount = {};
    animeList.forEach(a => {
        if (a.genres) {
            a.genres.split(',').map(g => g.trim()).forEach(g => {
                if (g) genreCount[g] = (genreCount[g] || 0) + 1;
            });
        }
    });
    const sortedGenres = Object.entries(genreCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const maxGenreCount = sortedGenres.length ? sortedGenres[0][1] : 0;

    let html = `
        <div class="stats-grid">
            <div class="stat-card"><span class="stat-emoji">🎬</span><div class="stat-value">${total}</div><div class="stat-label">Всего аниме</div></div>
            <div class="stat-card"><span class="stat-emoji">📺</span><div class="stat-value">${eqEpisodes}</div><div class="stat-label">Эп×20м (≈${totalEpisodes} сер.)</div></div>
            <div class="stat-card"><span class="stat-emoji">⏱️</span><div class="stat-value">${timeStr}</div><div class="stat-label">Реального времени</div></div>
            <div class="stat-card"><span class="stat-emoji">⭐</span><div class="stat-value">${avgFinal}</div><div class="stat-label">Средняя оценка</div></div>
            <div class="stat-card"><span class="stat-emoji">📊</span><div class="stat-value">${avgAvg}</div><div class="stat-label">Средний балл (без вайба)</div></div>
            ${totalRewatches > 0 ? `<div class="stat-card"><span class="stat-emoji">🔄</span><div class="stat-value">${totalRewatches}</div><div class="stat-label">Пересмотров</div></div>` : ''}
        </div>
    `;

    if (top3.length) {
        html += `<h3 class="section-title">🏆 Топ-3 по среднему баллу</h3>`;
        html += `<div class="podium">`;
        top3.forEach((anime, index) => {
            const place = index + 1;
            const order = place === 1 ? 'first' : (place === 2 ? 'second' : 'third');
            html += `
                <div class="podium-item ${order}" onclick="editAnime('${anime.id}')">
                    <div class="podium-medal" style="background: ${medalColors[place-1]}">${place}</div>
                    <img src="${anime.poster || getPlaceholderImage(anime.title)}" class="podium-poster">
                    <div class="podium-info">
                        <div class="podium-title">${escapeHtml(anime.title)}</div>
                        <div class="podium-score">${anime.avgScore.toFixed(1)} <span class="podium-final">(${anime.finalScore.toFixed(1)})</span></div>
                        <div class="podium-label">${medalNames[place-1]}</div>
                    </div>
                </div>
            `;
        });
        html += `</div>`;
    }

    html += `
        <div class="distribution-section">
            <h3 class="section-title">📈 Распределение финальных оценок</h3>
            <div class="distribution-radar">${radarFinalSvg}</div>
            <div class="distribution-labels">
                ${categories.map((cat, i) => {
                    const hue = (i * 360) / categories.length;
                    return `<div><span class="distr-dot" style="background: hsl(${hue}, 70%, 50%)"></span>${cat}: <strong>${countsFinal[i]}</strong></div>`;
                }).join('')}
            </div>
        </div>
    `;

    html += `
        <div class="distribution-section">
            <h3 class="section-title">📊 Распределение средних оценок (без вайба)</h3>
            <div class="distribution-radar">${radarAvgSvg}</div>
            <div class="distribution-labels">
                ${categories.map((cat, i) => {
                    const hue = (i * 360) / categories.length;
                    return `<div><span class="distr-dot" style="background: hsl(${hue}, 70%, 50%)"></span>${cat}: <strong>${countsAvg[i]}</strong></div>`;
                }).join('')}
            </div>
        </div>
    `;

    if (sortedGenres.length) {
        html += `<h3 class="section-title">🎭 Статистика жанров</h3>`;
        html += `<div class="genres-stats">`;
        sortedGenres.forEach(([genre, cnt]) => {
            const percent = Math.round((cnt / maxGenreCount) * 100);
            html += `
                <div class="genre-bar-row">
                    <span class="genre-name">${escapeHtml(genre)}</span>
                    <span class="genre-count">${cnt}</span>
                    <div class="genre-bar-bg"><div class="genre-bar-fill" style="width: ${percent}%"></div></div>
                </div>
            `;
        });
        html += `</div>`;
    }

    container.innerHTML = html;
}

// ── Инфляция и дубликаты (всегда включены) ────────────────────
function checkInflation() {
    if (animeList.length < 10) return;
    const last10 = [...animeList].sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
    const allHigh = last10.every(a => a.finalScore > 8);
    if (allHigh) showToast('⚠️ Последние 10 оценок — все выше 8. Не завышаешь ли?', 'warning', 5000);
}

function findDuplicate(title, excludeId = null) {
    const norm = t => t.toLowerCase().replace(/[^a-zа-яёa-z0-9]/gi, '');
    const q = norm(title);
    return animeList.find(a => a.id !== excludeId && norm(a.title) === q) || null;
}

// ── Toast-уведомления ─────────────────────────────────────────
function showToast(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    const colors = { info: 'var(--accent)', success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)' };
    toast.style.cssText = `
        position:fixed;bottom:80px;left:50%;transform:translateX(-50%) translateY(20px);
        background:var(--card);border:1px solid ${colors[type] || colors.info};
        color:var(--text);padding:0.75rem 1.25rem;border-radius:var(--radius-sm);
        font-size:0.875rem;box-shadow:var(--shadow);z-index:9997;
        opacity:0;transition:all 0.25s ease;max-width:90vw;text-align:center;
        border-left:3px solid ${colors[type] || colors.info};
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ── Переключатель режима карточек (с сохранением в localStorage) ──
function initCardSizeToggle() {
    const saved = localStorage.getItem('cardSize');
    if (saved && ['default', 'compact', 'gallery'].includes(saved)) {
        document.body.classList.add(`view-${saved}`);
    } else {
        document.body.classList.add('view-default');
    }

    const btns = document.querySelectorAll('.card-size-btn');
    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            const size = btn.dataset.size;
            document.body.classList.remove('view-default', 'view-compact', 'view-gallery');
            if (size !== 'default') {
                document.body.classList.add(`view-${size}`);
            } else {
                document.body.classList.add('view-default');
            }
            localStorage.setItem('cardSize', size);
            // обновим активный класс
            btns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
        if ((saved && btn.dataset.size === saved) || (!saved && btn.dataset.size === 'default')) {
            btn.classList.add('active');
        }
    });
}

// ── Редактор приватных заметок ────────────────────────────────
function getNotesEditor() { return document.getElementById('notesEditor'); }
function getNotesInput()  { return document.getElementById('notesInput'); }

function syncNotesEditorToInput() {
    const editor = getNotesEditor();
    const input  = getNotesInput();
    if (editor && input) input.value = editor.innerHTML;
}

function syncNotesInputToEditor(html) {
    const editor = getNotesEditor();
    if (!editor) return;
    editor.innerHTML = html || '';
}

function notesExec(cmd) {
    const editor = getNotesEditor();
    if (!editor) return;
    editor.focus();
    document.execCommand(cmd, false, null);
    syncNotesEditorToInput();
    saveDraft();
}

const NOTE_SIZES = ['0.75rem', '0.875rem', '1.1rem'];

function notesFontSize(level) {
    // level: 1=small, 2=normal, 3=large
    const editor = getNotesEditor();
    if (!editor) return;
    editor.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const span  = document.createElement('span');
    span.style.fontSize = NOTE_SIZES[level - 1];
    try {
        range.surroundContents(span);
    } catch {
        // partial selection fallback
        span.appendChild(range.extractContents());
        range.insertNode(span);
    }
    syncNotesEditorToInput();
    saveDraft();
}

function notesColor(color) {
    const editor = getNotesEditor();
    if (!editor) return;
    editor.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);

    if (!color) {
        // Убрать цвет — снимаем highlight у всех span внутри выделения
        document.execCommand('removeFormat', false, null);
        syncNotesEditorToInput();
        saveDraft();
        return;
    }

    const span = document.createElement('mark');
    span.style.cssText = `background:${color};color:#111;border-radius:3px;padding:0 2px;`;
    try {
        range.surroundContents(span);
    } catch {
        span.appendChild(range.extractContents());
        range.insertNode(span);
    }
    syncNotesEditorToInput();
    saveDraft();
}

function initNotesEditor() {
    const editor = getNotesEditor();
    if (!editor) return;
    editor.addEventListener('input', () => {
        syncNotesEditorToInput();
        saveDraft();
    });
    editor.addEventListener('paste', e => {
        // Вставляем только plaintext, чтобы не тащить чужие стили
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, text);
    });
}

window.notesExec    = notesExec;
window.notesFontSize = notesFontSize;
window.notesColor   = notesColor;

// ── Экспорт в глобальную область ─────────────────────────────
window.editAnime          = editAnime;
window.confirmDelete      = confirmDelete;
window.dismissReminder    = dismissReminder;
window.searchShikimoriPosterForSeason = searchShikimoriPosterForSeason;
window.VIBE_MAP           = VIBE_MAP;