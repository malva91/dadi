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
        this.deckStateRef = null;
        this.deckListener = null;
        this.currentRoomCode = null;

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

    async extractCard(currentUser) {
        if (!this.deckStateRef) {
            throw new Error('Sistema estrazione non inizializzato per questa stanza');
        }

        if (!currentUser || !currentUser.id || !currentUser.name) {
            throw new Error('Utente non valido');
        }

        try {
            const snapshot = await this.deckStateRef.once('value');
            const deckState = snapshot.val();

            if (!deckState || !deckState.currentDeck || deckState.currentDeck.length === 0) {
                throw new Error('Mazzo vuoto! Usa il pulsante Reset per ricominciare.');
            }

            const currentDeck = deckState.currentDeck;
            const randomIndex = Math.floor(Math.random() * currentDeck.length);
            const extractedCard = currentDeck[randomIndex];

            const newDeck = [...currentDeck];
            newDeck.splice(randomIndex, 1);

            await this.deckStateRef.update({
                currentDeck: newDeck,
                lastExtraction: extractedCard,
                lastExtractedBy: currentUser.name,
                lastExtractedAt: Date.now()
            });

            return {
                value: extractedCard,
                remaining: newDeck.length,
                totalCards: deckState.totalCards || this.originalDeck.length
            };
        } catch (error) {
            console.error('Errore estrazione carta:', error);
            throw error;
        }
    }

    async resetDeck() {
        if (!this.deckStateRef) {
            throw new Error('Sistema estrazione non inizializzato per questa stanza');
        }

        try {
            await this.deckStateRef.set({
                currentDeck: [...this.originalDeck],
                totalCards: this.originalDeck.length,
                lastExtraction: null,
                lastExtractedBy: null,
                lastExtractedAt: null
            });

            return {
                remaining: this.originalDeck.length,
                totalCards: this.originalDeck.length,
                message: 'Mazzo resettato!'
            };
        } catch (error) {
            console.error('Errore reset mazzo:', error);
            throw error;
        }
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
        if (!this.currentDeck) {
            return {
                isVisible: this.isVisible,
                isEnabled: this.isEnabled,
                currentCards: [],
                remaining: 0,
                totalCards: 0,
                lastExtraction: null,
                progress: 0
            };
        }

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

    async setupRoomDeck(roomCode) {
        if (!roomCode || !this.database) {
            console.error('setupRoomDeck: parametri non validi');
            return;
        }

        this.currentRoomCode = roomCode;
        this.deckStateRef = this.database.ref(`rooms/${roomCode}/extractionState`);

        try {
            const snapshot = await this.deckStateRef.once('value');
            const deckState = snapshot.val();

            if (!deckState || !deckState.currentDeck) {
                await this.deckStateRef.set({
                    currentDeck: [...this.originalDeck],
                    totalCards: this.originalDeck.length,
                    lastExtraction: null,
                    lastExtractedBy: null,
                    lastExtractedAt: null
                });
                this.currentDeck = [...this.originalDeck];
            } else {
                this.currentDeck = deckState.currentDeck || [];
            }

            this.setupDeckListener();
        } catch (error) {
            console.error('Errore setup room deck:', error);
            this.currentDeck = [...this.originalDeck];
        }
    }

    setupDeckListener() {
        if (!this.deckStateRef) return;

        if (this.deckListener) {
            this.deckStateRef.off('value', this.deckListener);
        }

        this.deckListener = this.deckStateRef.on('value', (snapshot) => {
            try {
                const deckState = snapshot.val();
                if (!deckState) return;

                this.currentDeck = deckState.currentDeck || [];
                this.lastExtraction = deckState.lastExtraction || null;

                if (window.app && typeof window.app.updateExtractionUI === 'function') {
                    window.app.updateExtractionUI();
                }
            } catch (error) {
                console.error('Errore listener deck:', error);
            }
        });
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

        if (this.deckStateRef && this.deckListener) {
            try {
                this.deckStateRef.off('value', this.deckListener);
            } catch (error) {
                console.warn('Errore rimozione listener deck:', error);
            }
            this.deckListener = null;
        }

        this.deckStateRef = null;
        this.currentRoomCode = null;
    }
}

window.ExtractionSystem = ExtractionSystem;
