class ExtractionSystem {
    constructor(database) {
        this.database = database;
        this.configRef = this.database.ref('extractionSystem/config');
        this.decksRef = this.database.ref('extractionSystem/decks');

        this.isVisible = false;
        this.isEnabled = false;
        this.currentDeck = null;
        this.originalDeck = null;
        this.lastExtraction = null;
        this.listeners = [];

        this.loadConfiguration();
    }

    async loadConfiguration() {
        try {
            const snap = await this.configRef.once('value');
            const config = snap.val();

            if (config) {
                this.isVisible = config.visible || false;
                this.isEnabled = config.enabled || false;
                this.originalDeck = config.defaultDeck || this.getDefaultDeck();
                this.currentDeck = [...this.originalDeck];
            } else {
                this.originalDeck = this.getDefaultDeck();
                this.currentDeck = [...this.originalDeck];
                await this.saveConfiguration();
            }

            this.setupConfigListener();
            return { visible: this.isVisible, enabled: this.isEnabled };
        } catch (error) {
            console.error('Errore caricamento configurazione ExtractSystem:', error);
            this.originalDeck = this.getDefaultDeck();
            this.currentDeck = [...this.originalDeck];
        }
    }

    setupConfigListener() {
        const listener = this.configRef.on('value', (snap) => {
            const config = snap.val();
            if (config) {
                this.isVisible = config.visible || false;
                this.isEnabled = config.enabled || false;

                if (config.defaultDeck && JSON.stringify(config.defaultDeck) !== JSON.stringify(this.originalDeck)) {
                    this.originalDeck = config.defaultDeck;
                    this.currentDeck = [...this.originalDeck];
                }
            }
        }, (error) => {
            console.error('Errore listener configurazione ExtractSystem:', error);
        });

        this.listeners.push({ ref: this.configRef, callback: listener });
    }

    getDefaultDeck() {
        return ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
    }

    async saveConfiguration() {
        try {
            await this.configRef.set({
                visible: this.isVisible,
                enabled: this.isEnabled,
                defaultDeck: this.originalDeck,
                updatedAt: Date.now()
            });
        } catch (error) {
            console.error('Errore salvataggio configurazione ExtractSystem:', error);
            throw error;
        }
    }

    extractCard() {
        if (!this.currentDeck || this.currentDeck.length === 0) {
            throw new Error('Mazzo vuoto! Usa il pulsante Reset per ricominciare.');
        }

        const randomIndex = Math.floor(Math.random() * this.currentDeck.length);
        const extractedCard = this.currentDeck[randomIndex];

        this.currentDeck.splice(randomIndex, 1);
        this.lastExtraction = extractedCard;

        return {
            value: extractedCard,
            remaining: this.currentDeck.length,
            totalCards: this.originalDeck.length
        };
    }

    resetDeck() {
        this.currentDeck = [...this.originalDeck];
        this.lastExtraction = null;

        return {
            remaining: this.currentDeck.length,
            totalCards: this.originalDeck.length,
            message: 'Mazzo resettato!'
        };
    }

    setVisible(visible) {
        this.isVisible = visible;
        return this.saveConfiguration();
    }

    setEnabled(enabled) {
        this.isEnabled = enabled;
        return this.saveConfiguration();
    }

    setDefaultDeck(deckArray) {
        if (!Array.isArray(deckArray) || deckArray.length === 0) {
            throw new Error('Il mazzo deve essere un array non vuoto');
        }

        this.originalDeck = deckArray.map(item => String(item));
        this.currentDeck = [...this.originalDeck];
        this.lastExtraction = null;

        return this.saveConfiguration();
    }

    getCurrentState() {
        return {
            isVisible: this.isVisible,
            isEnabled: this.isEnabled,
            currentCards: [...this.currentDeck],
            remaining: this.currentDeck.length,
            totalCards: this.originalDeck.length,
            lastExtraction: this.lastExtraction,
            progress: this.originalDeck.length > 0 ?
                Math.round(((this.originalDeck.length - this.currentDeck.length) / this.originalDeck.length) * 100) :
                0
        };
    }

    cleanup() {
        this.listeners.forEach(({ ref, callback }) => {
            try {
                ref.off('value', callback);
            } catch (error) {
                console.warn('Errore rimozione listener ExtractSystem:', error);
            }
        });
        this.listeners = [];
    }
}

window.ExtractionSystem = ExtractionSystem;
