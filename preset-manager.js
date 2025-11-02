class PresetManager {
    constructor(firestore) {
        this.firestore = firestore;
        this.fsPresetsCol = this.firestore.collection('presets');
        this.presets = [];
        this.currentPreset = null;
        this.presetsCache = null;
        this.cacheTimestamp = 0;
        this.cacheTTL = 300000;
    }

    async loadPresets(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && this.presetsCache && (now - this.cacheTimestamp < this.cacheTTL)) {
            this.presets = this.presetsCache;
            return;
        }

        try {
            const snap = await this.fsPresetsCol.get();
            if (!snap || !snap.docs) {
                console.warn('Nessun documento preset trovato');
                this.presets = [];
                this.presetsCache = [];
                this.cacheTimestamp = now;
                return;
            }

            const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            this.presets = arr.map(p => {
                const merged = { ...p };
                if (typeof merged.visible === 'undefined') merged.visible = true;
                if (!Array.isArray(merged.tags)) merged.tags = [];
                if (!Array.isArray(merged.dice)) merged.dice = [];
                if (!Array.isArray(merged.rules)) merged.rules = [];
                if (!merged.name) merged.name = 'Preset Senza Nome';
                if (typeof merged.modifier === 'undefined') merged.modifier = 0;
                return merged;
            });
            this.presetsCache = this.presets;
            this.cacheTimestamp = now;
        } catch (err) {
            console.error('Errore lettura preset da Firestore:', err);
            this.presets = [];
        }
    }

    setupPresetListener(onPresetsUpdate) {
        this.fsPresetsCol.onSnapshot((snap) => {
            if (!snap || !snap.docs) {
                console.warn('Snapshot preset vuoto');
                this.presets = [];
                this.presetsCache = [];
                this.cacheTimestamp = Date.now();
                if (typeof onPresetsUpdate === 'function') onPresetsUpdate(this.presets);
                return;
            }

            const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            this.presets = arr.map(p => {
                const merged = { ...p };
                if (typeof merged.visible === 'undefined') merged.visible = true;
                if (!Array.isArray(merged.tags)) merged.tags = [];
                if (!Array.isArray(merged.dice)) merged.dice = [];
                if (!Array.isArray(merged.rules)) merged.rules = [];
                if (!merged.name) merged.name = 'Preset Senza Nome';
                if (typeof merged.modifier === 'undefined') merged.modifier = 0;
                return merged;
            });
            this.presetsCache = this.presets;
            this.cacheTimestamp = Date.now();
            if (typeof onPresetsUpdate === 'function') onPresetsUpdate(this.presets);
        }, (error) => {
            console.error('Errore listener preset:', error);
            this.presets = [];
            if (typeof onPresetsUpdate === 'function') onPresetsUpdate(this.presets);
        });
    }

    getPresets() {
        return Array.isArray(this.presets) ? this.presets : [];
    }

    setCurrentPreset(preset) {
        this.currentPreset = preset;
    }

    getCurrentPreset() {
        return this.currentPreset;
    }

    clearCurrentPreset() {
        this.currentPreset = null;
    }
}

window.PresetManager = PresetManager;
