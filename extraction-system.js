class ExtractionSystem {
    constructor(database, firestore) {
        this.database = database;
        this.firestore = firestore || window.firestore;

        this.isVisible = false;
        this.isEnabled = false;
        this.currentDeck = null;
        this.originalDeck = null;
        this.lastExtraction = null;
        this.unsubscribe = null;

        this.loadConfiguration();
    }

    async loadConfiguration() {
        try {
            const configDoc = await this.firestore.collection('effectsConfig').doc('config').get();
            const config = configDoc.exists ? configDoc.data() : {};

            if (config) {
                this.isVisible = config.extractionSystemVisible || false;
                this.isEnabled = config.extractionSystemVisible || false;
                this.originalDeck = config.extractionDeck || this.getDefaultDeck();
                this.currentDeck = [...this.originalDeck];
            } else {
                this.originalDeck = this.getDefaultDeck();
                this.currentDeck = [...this.originalDeck];
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
        if (this.unsubscribe) {
            this.unsubscribe();
        }

        this.unsubscribe = this.firestore.collection('effectsConfig').doc('config')
            .onSnapshot((doc) => {
                if (!doc.exists) return;

                const config = doc.data();
                const newVisible = config.extractionSystemVisible || false;
                const newDeck = config.extractionDeck || this.getDefaultDeck();

                this.isVisible = newVisible;
                this.isEnabled = newVisible;

                if (JSON.stringify(newDeck) !== JSON.stringify(this.originalDeck)) {
                    this.originalDeck = newDeck;
                    this.currentDeck = [...this.originalDeck];
                }
            }, (error) => {
                console.error('Errore listener configurazione ExtractSystem:', error);
            });
    }

    getDefaultDeck() {
        return ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
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

    async setVisible(visible) {
        this.isVisible = visible;
        this.isEnabled = visible;
        try {
            const configRef = this.firestore.collection('effectsConfig').doc('config');
            const currentConfig = (await configRef.get()).data() || {};
            await configRef.set({
                ...currentConfig,
                extractionSystemVisible: visible
            });
        } catch (error) {
            console.error('Errore salvataggio visibilità ExtractSystem:', error);
            throw error;
        }
    }

    async setEnabled(enabled) {
        this.isEnabled = enabled;
        this.isVisible = enabled;
        try {
            const configRef = this.firestore.collection('effectsConfig').doc('config');
            const currentConfig = (await configRef.get()).data() || {};
            await configRef.set({
                ...currentConfig,
                extractionSystemVisible: enabled
            });
        } catch (error) {
            console.error('Errore salvataggio enabled ExtractSystem:', error);
            throw error;
        }
    }

    async setDefaultDeck(deckArray) {
        if (!Array.isArray(deckArray) || deckArray.length === 0) {
            throw new Error('Il mazzo deve essere un array non vuoto');
        }

        this.originalDeck = deckArray.map(item => String(item));
        this.currentDeck = [...this.originalDeck];
        this.lastExtraction = null;

        try {
            const configRef = this.firestore.collection('effectsConfig').doc('config');
            const currentConfig = (await configRef.get()).data() || {};
            await configRef.set({
                ...currentConfig,
                extractionDeck: this.originalDeck
            });
        } catch (error) {
            console.error('Errore salvataggio mazzo ExtractSystem:', error);
            throw error;
        }
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
        if (this.unsubscribe) {
            try {
                this.unsubscribe();
            } catch (error) {
                console.warn('Errore rimozione listener ExtractSystem:', error);
            }
            this.unsubscribe = null;
        }
    }
}

window.ExtractionSystem = ExtractionSystem;
