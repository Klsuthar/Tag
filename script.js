document.addEventListener('DOMContentLoaded', () => {
    // --- App State ---
    const appState = {
        currentVideo: null, videoId: null, videoName: '',
        duration: 0, isTyping: false, pendingHistoryLoad: null
    };

    // --- DOM Element Cache ---
    const elements = {
        tabBtns: document.querySelectorAll('.tab-btn'),
        appPanels: document.querySelectorAll('.app-panel'),
        loadVideoBtn: document.getElementById('load-video-btn'),
        videoInput: document.getElementById('video-input'),
        videoPlaceholder: document.getElementById('video-placeholder'),
        videoWrapper: document.getElementById('video-wrapper'),
        video: document.getElementById('main-video'),
        playPauseBtn: document.getElementById('play-pause-btn'),
        timeline: document.getElementById('timeline'),
        currentTimeEl: document.getElementById('current-time'),
        totalTimeEl: document.getElementById('total-time'),
        frameBackwardBtn: document.getElementById('frame-backward-btn'),
        frameForwardBtn: document.getElementById('frame-forward-btn'),
        speedSelect: document.getElementById('speed-select'),
        muteBtn: document.getElementById('mute-btn'),
        volumeSlider: document.getElementById('volume-slider'),
        fullscreenBtn: document.getElementById('fullscreen-btn'),
        saveSessionBtn: document.getElementById('save-session-btn'),
        exportJsonBtn: document.getElementById('export-json-btn'),
        importJsonBtn: document.getElementById('import-json-btn'),
        jsonInput: document.getElementById('json-input'),
        addTagBtn: document.getElementById('add-tag-btn'),
        videoLocationInput: document.getElementById('video-location-input'),
        videoGeneralDescriptionInput: document.getElementById('video-general-description'),
        tagsList: document.getElementById('tags-list'),
        tagsLegend: document.getElementById('tags-legend'),
        historyList: document.getElementById('history-list'),
        toastContainer: document.getElementById('toast-container')
    };

    const FRAME_RATE = 30;
    const LOCAL_STORAGE_KEY = 'videoTaggerHistory';
    let sessionTags = [];

    // --- Initialization & Event Setup ---
    function initializeApp() {
        setupEventListeners();
        renderHistory();
        switchTab('tagger');
    }

    function setupEventListeners() {
        elements.tabBtns.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
        elements.loadVideoBtn.addEventListener('click', () => elements.videoInput.click());
        elements.videoInput.addEventListener('change', handleVideoLoad);
        elements.importJsonBtn.addEventListener('click', () => elements.jsonInput.click());
        elements.jsonInput.addEventListener('change', handleJsonImport);
        elements.saveSessionBtn.addEventListener('click', handleSaveSession);
        elements.exportJsonBtn.addEventListener('click', handleJsonExport);
        elements.video.addEventListener('loadedmetadata', initializeVideo);
        elements.video.addEventListener('timeupdate', updateTimeline);
        elements.video.addEventListener('play', () => updatePlayPauseIcon(true));
        elements.video.addEventListener('pause', () => updatePlayPauseIcon(false));
        elements.video.addEventListener('click', togglePlayPause);
        elements.playPauseBtn.addEventListener('click', togglePlayPause);
        elements.timeline.addEventListener('input', () => elements.video.currentTime = elements.timeline.value);
        elements.frameForwardBtn.addEventListener('click', () => seekFrames(1));
        elements.frameBackwardBtn.addEventListener('click', () => seekFrames(-1));
        elements.speedSelect.addEventListener('change', (e) => elements.video.playbackRate = e.target.value);
        elements.muteBtn.addEventListener('click', toggleMute);
        elements.volumeSlider.addEventListener('input', (e) => { elements.video.volume = e.target.value; elements.video.muted = e.target.value === '0'; });
        elements.video.addEventListener('volumechange', updateVolumeUI);
        elements.fullscreenBtn.addEventListener('click', toggleFullscreen);
        elements.addTagBtn.addEventListener('click', createNewEditableTag);
        elements.tagsList.addEventListener('click', handleTagListClick);
        elements.historyList.addEventListener('click', handleHistoryClick);
        const inputsForTypingCheck = [elements.videoLocationInput, elements.videoGeneralDescriptionInput];
        inputsForTypingCheck.forEach(input => {
            input.addEventListener('focus', () => appState.isTyping = true);
            input.addEventListener('blur', () => appState.isTyping = false);
        });
        document.addEventListener('keydown', handleKeydown);
    }
    
    // --- Core App Logic ---
    function switchTab(tabName) {
        elements.appPanels.forEach(p => p.classList.remove('active'));
        document.getElementById(`${tabName}-panel`).classList.add('active');
        elements.tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
        if (tabName === 'history') renderHistory();
    }

    function handleVideoLoad(e) {
        const file = e.target.files[0];
        if (!file) return;
        resetWorkspace();
        appState.currentVideo = file;
        elements.video.src = URL.createObjectURL(file);
        appState.videoName = file.name;
        appState.videoId = `${file.name.replace(/\.[^/.]+$/, '')}_${Date.now()}`;
        elements.videoPlaceholder.classList.add('hidden');
        elements.videoWrapper.classList.remove('hidden');
        [elements.saveSessionBtn, elements.exportJsonBtn, elements.addTagBtn].forEach(btn => btn.disabled = false);
        if (appState.pendingHistoryLoad && appState.currentVideo.name === appState.pendingHistoryLoad.videoName) {
            loadDataFromSession(appState.pendingHistoryLoad);
            appState.pendingHistoryLoad = null;
        }
    }

    function initializeVideo() {
        appState.duration = elements.video.duration;
        elements.totalTimeEl.textContent = formatTime(appState.duration);
        elements.timeline.max = appState.duration;
    }

    function handleKeydown(e) {
        if (appState.isTyping || document.querySelector('.tag-item.editable')) return;
        switch (e.key) {
            case ' ': e.preventDefault(); togglePlayPause(); break;
            case 'ArrowRight': e.preventDefault(); seekFrames(1); break;
            case 'ArrowLeft': e.preventDefault(); seekFrames(-1); break;
            case 'n': case 'N':
                e.preventDefault();
                if (!elements.addTagBtn.disabled) createNewEditableTag();
                break;
        }
    }

    // --- Inline Tagging Logic ---
    function createNewEditableTag() {
        if (document.querySelector('.tag-item.editable')) return;
        elements.video.pause();
        const newTagId = `tag_${Date.now()}`;
        const timestamp = elements.video.currentTime;
        const editableTagEl = document.createElement('div');
        editableTagEl.className = 'tag-item editable';
        editableTagEl.dataset.id = newTagId;
        editableTagEl.innerHTML = createEditableFormHTML({ id: newTagId, timestamp });
        const firstTag = elements.tagsList.firstChild;
        elements.tagsList.insertBefore(editableTagEl, firstTag);
        setupFormEventListeners(editableTagEl);
        editableTagEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    
    function makeTagEditable(tagId) {
        if (document.querySelector('.tag-item.editable')) {
            showToast('Please save or cancel the current tag first.', 'info');
            return;
        }
        const tagItem = document.querySelector(`.tag-item[data-id="${tagId}"]`);
        const originalTagData = sessionTags.find(t => t.id === tagId);
        if (!tagItem || !originalTagData) return;

        elements.video.pause();
        const newTimestamp = elements.video.currentTime;

        const formData = {
            ...originalTagData,
            timestamp: newTimestamp
        };
        
        tagItem.classList.add('editable');
        tagItem.innerHTML = createEditableFormHTML(formData);
        setupFormEventListeners(tagItem);
    }

    function createEditableFormHTML(tagData) {
        return `
            <div class="tag-item-edit-form">
                <input type="hidden" name="id" value="${tagData.id}">
                <input type="hidden" name="timestamp" value="${tagData.timestamp}">
                <div class="form-group">
                    <label>Tag Name</label>
                    <input type="text" name="tag" value="${tagData.tag || ''}" required onkeydown="if(event.key==='Enter'){event.preventDefault(); this.closest('.tag-item-edit-form').querySelector('[data-action=save]').click();}">
                </div>
                <div class="form-group">
                    <label>Description</label>
                    <textarea name="describe" rows="3">${tagData.describe || ''}</textarea>
                </div>
                <div class="editable-tag-actions">
                    <button type="button" class="btn btn-secondary" data-action="cancel">Cancel</button>
                    <button type="submit" class="btn btn-success" data-action="save">Save</button>
                </div>
            </div>`;
    }

    function setupFormEventListeners(formContainer) {
        const form = formContainer.querySelector('.tag-item-edit-form');
        const inputs = form.querySelectorAll('input, textarea');
        inputs.forEach(input => {
            input.addEventListener('focus', () => appState.isTyping = true);
            input.addEventListener('blur', () => appState.isTyping = false);
        });
        form.querySelector('input[name="tag"]').focus();
    }

    function handleTagListClick(e) {
        const target = e.target;
        const tagItem = target.closest('.tag-item');
        if (!tagItem) return;
        const tagId = tagItem.dataset.id;
        if (tagItem.classList.contains('editable')) {
            if (target.closest('[data-action="save"]')) {
                const form = tagItem.querySelector('.tag-item-edit-form');
                handleTagSave(form);
            } else if (target.closest('[data-action="cancel"]')) {
                renderTags(); 
            }
            return;
        }
        const actionBtn = target.closest('.btn');
        if (actionBtn) {
            const action = actionBtn.dataset.action;
            if (action === 'edit') makeTagEditable(tagId);
            else if (action === 'delete') {
                if (confirm(`Are you sure you want to delete this tag?`)) {
                    sessionTags = sessionTags.filter(t => t.id !== tagId);
                    renderTags();
                }
            }
        } else {
            const tag = sessionTags.find(t => t.id === tagId);
            if (tag) elements.video.currentTime = tag.timestamp;
        }
    }

    function handleTagSave(form) {
        const tagData = {
            id: form.querySelector('[name="id"]').value,
            timestamp: parseFloat(form.querySelector('[name="timestamp"]').value),
            frame: Math.round(parseFloat(form.querySelector('[name="timestamp"]').value) * FRAME_RATE),
            tag: form.querySelector('[name="tag"]').value.trim(),
            describe: form.querySelector('[name="describe"]').value.trim()
        };
        const existingIndex = sessionTags.findIndex(t => t.id === tagData.id);
        if (existingIndex > -1) sessionTags[existingIndex] = tagData;
        else sessionTags.push(tagData);
        renderTags();
    }
    
    function renderTags() {
        elements.tagsLegend.innerHTML = `<i class="fas fa-tags"></i> Tags (${sessionTags.length})`;
        elements.tagsList.innerHTML = sessionTags.length === 0 ? '<p class="no-data-message">No tags added yet.</p>' : '';
        if (sessionTags.length === 0) return;
        sessionTags.sort((a, b) => a.timestamp - b.timestamp);
        sessionTags.forEach(tag => {
            const tagEl = document.createElement('div');
            tagEl.className = 'tag-item';
            tagEl.dataset.id = tag.id;
            tagEl.innerHTML = `
                <div class="tag-item-content">
                    <div class="tag-item-header">
                        <span class="tag-item-tag">${tag.tag || 'Untitled Tag'}</span>
                        <div class="tag-item-actions">
                            <button class="btn btn-secondary btn-sm" data-action="edit" title="Edit"><i class="fas fa-edit"></i></button>
                            <button class="btn btn-danger btn-sm" data-action="delete" title="Delete"><i class="fas fa-times"></i></button>
                        </div>
                    </div>
                    <p class="tag-item-description">${tag.describe || 'No description.'}</p>
                    <div class="tag-item-time-info">
                        <span><i class="fas fa-clock"></i> T: ${formatTime(tag.timestamp)}</span>
                        <span><i class="fas fa-film"></i> F: ${tag.frame}</span>
                    </div>
                </div>`;
            elements.tagsList.appendChild(tagEl);
        });
    }

    function getSessionData() {
        if (!appState.currentVideo) return null;
        return {
            videoId: appState.videoId, videoName: appState.videoName,
            location: elements.videoLocationInput.value.trim(),
            generalDescription: elements.videoGeneralDescriptionInput.value.trim(),
            duration: appState.duration, tags: sessionTags.map(({ id, ...rest }) => rest)
        };
    }
    
    function handleSaveSession() {
        const data = getSessionData();
        if (!data) { showToast('No video loaded to save.', 'error'); return; }
        const history = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');
        history[data.videoId] = data;
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(history));
        showToast('Session saved successfully!', 'success');
        renderHistory();
    }

    function handleJsonExport() {
        const data = getSessionData();
        if (!data) { showToast('No data to export.', 'error'); return; }
        const jsonString = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${appState.videoName.split('.')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function handleJsonImport(e) {
        const files = Array.from(e.target.files);
        const history = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');
        let importedCount = 0;
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = JSON.parse(event.target.result);
                    if (data.videoId && data.videoName && Array.isArray(data.tags)) {
                        history[data.videoId] = data;
                        importedCount++;
                    }
                } catch (error) { console.error('Error parsing file:', file.name); }
            };
            reader.readAsText(file);
        });
        setTimeout(() => {
            if (importedCount > 0) {
                localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(history));
                showToast(`${importedCount} session(s) imported successfully!`, 'success');
                renderHistory();
            } else {
                showToast('No valid session files found to import.', 'error');
            }
        }, 500);
    }

    function renderHistory() {
        const history = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');
        const videoIds = Object.keys(history);
        elements.historyList.innerHTML = ''; // Clear the list first

        if (videoIds.length === 0) {
            elements.historyList.innerHTML = '<p class="no-data-message">No saved sessions found.</p>';
            return;
        }

        videoIds
            .sort((a, b) => b.split('_').pop() - a.split('_').pop())
            .forEach(id => {
                const item = history[id];
                const historyItemEl = document.createElement('div');
                historyItemEl.className = 'history-item';
                historyItemEl.dataset.id = id;
                historyItemEl.innerHTML = `
                <div class="history-item-main">
                    <button class="btn btn-icon btn-sm expand-btn" data-action="expand"><i class="fas fa-chevron-right"></i></button>
                    <div class="history-item-details">
                        <div class="history-item-name">${item.videoName}</div>
                        <div class="history-item-info">
                            <span><i class="fas fa-map-marker-alt"></i> ${item.location || 'N/A'}</span>
                            <span><i class="fas fa-tags"></i> ${item.tags.length} tags</span>
                            <span><i class="fas fa-clock"></i> ${formatTime(item.duration)}</span>
                        </div>
                    </div>
                    <div class="history-item-actions">
                        <button class="btn btn-secondary" data-action="load"><i class="fas fa-upload"></i> Load</button>
                        <button class="btn btn-secondary" data-action="export"><i class="fas fa-file-export"></i> Export</button>
                        <button class="btn btn-danger" data-action="delete"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
                <div class="json-view" style="display: none;"></div>`;
                elements.historyList.appendChild(historyItemEl);
            });
    }

    function handleHistoryClick(e) {
        const itemEl = e.target.closest('.history-item');
        if (!itemEl) return;

        const id = itemEl.dataset.id;
        const history = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');
        const sessionData = history[id];

        if (e.target.classList.contains('copy-json-btn')) {
            const jsonText = itemEl.querySelector('pre code').innerText;
            navigator.clipboard.writeText(jsonText).then(() => {
                showToast('JSON copied to clipboard!', 'success');
            });
            return;
        }

        const actionBtn = e.target.closest('.btn');
        if (!actionBtn) return;
        const action = actionBtn.dataset.action;

        switch (action) {
            case 'delete':
                if (confirm(`Are you sure you want to delete this session?`)) {
                    delete history[id];
                    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(history));
                    renderHistory();
                }
                break;
            case 'load':
                appState.pendingHistoryLoad = sessionData;
                switchTab('tagger');
                showToast(`Please load the video file: "${sessionData.videoName}"`, 'info', 5000);
                elements.videoInput.click();
                break;
            case 'export':
                exportSessionAsJson(sessionData);
                break;
            case 'expand':
                const jsonView = itemEl.querySelector('.json-view');
                const expandIcon = actionBtn.querySelector('i');
                itemEl.classList.toggle('expanded');
                if (itemEl.classList.contains('expanded')) {
                    const jsonString = JSON.stringify(sessionData, null, 2);
                    jsonView.innerHTML = `<pre><code>${jsonString}</code></pre><button class="btn btn-primary btn-sm copy-json-btn">Copy</button>`;
                    jsonView.style.display = 'block';
                    expandIcon.className = 'fas fa-chevron-down';
                } else {
                    jsonView.style.display = 'none';
                    expandIcon.className = 'fas fa-chevron-right';
                }
                break;
        }
    }

    function exportSessionAsJson(data) {
        if (!data) { showToast('No data to export.', 'error'); return; }
        const jsonString = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${data.videoName.split('.')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function loadDataFromSession(data) {
        appState.videoId = data.videoId;
        elements.videoLocationInput.value = data.location || '';
        elements.videoGeneralDescriptionInput.value = data.generalDescription || '';
        sessionTags = data.tags.map(tag => ({
            ...tag,
            id: `tag_${Date.now()}_${Math.random()}`,
            frame: tag.frame || Math.round(tag.timestamp * FRAME_RATE)
        }));
        renderTags();
        showToast(`Successfully loaded session for "${data.videoName}".`, 'success');
    }
    
    function resetWorkspace() {
        sessionTags = [];
        elements.videoLocationInput.value = '';
        elements.videoGeneralDescriptionInput.value = '';
        renderTags();
    }
    
    function showToast(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        elements.toastContainer.appendChild(toast);
        setTimeout(() => toast.remove(), duration);
    }

    const togglePlayPause = () => elements.video.paused ? elements.video.play() : elements.video.pause();
    const updatePlayPauseIcon = (isPlaying) => elements.playPauseBtn.querySelector('i').className = `fas fa-${isPlaying ? 'pause' : 'play'}`;
    const updateTimeline = () => { elements.currentTimeEl.textContent = formatTime(elements.video.currentTime); elements.timeline.value = elements.video.currentTime; };
    const formatTime = (seconds) => new Date(seconds * 1000).toISOString().substr(14, 5);
    const seekFrames = (numFrames) => elements.video.currentTime += numFrames / FRAME_RATE;
    const toggleMute = () => elements.video.muted = !elements.video.muted;
    const updateVolumeUI = () => {
        const icon = elements.muteBtn.querySelector('i');
        if (elements.video.muted || elements.video.volume === 0) { icon.className = 'fas fa-volume-xmark'; elements.volumeSlider.value = 0; }
        else if (elements.video.volume < 0.5) { icon.className = 'fas fa-volume-low'; elements.volumeSlider.value = elements.video.volume; }
        else { icon.className = 'fas fa-volume-high'; elements.volumeSlider.value = elements.video.volume; }
    };
    const toggleFullscreen = () => document.fullscreenElement ? document.exitFullscreen() : elements.videoWrapper.requestFullscreen();

    initializeApp();
});