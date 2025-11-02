class TavernaDeiCaniDiOdino {
    constructor() {
        this.database = window.database;
        this.firestore = window.firestore;
        this.diceResultsRef = null;
        this.diceRollerVisible = true;
        this.fsEffectsConfigDoc = this.firestore.collection('effectsConfig').doc('config');
        this.fsCustomDiceTypesCol = this.firestore.collection('customDiceTypes');
        this.customDiceTypes = {};
        this.listeners = [];

        this.launchTypesRegistry = new window.LaunchTypesRegistry();
        this.colorTypesRegistry = new window.ColorTypesRegistry();

        this.validator = new window.InputValidator();
        this.storageManager = new window.StorageManager();
        this.errorHandler = new window.ErrorHandler();
        this.animations = new window.DiceAnimations();
        this.effectsEngine = new window.EffectsEngine();

        // Aspetta che le regole siano caricate
        this.effectsEngine.ensureConfigLoaded().then(() => {
            console.log('✅ EffectsEngine pronto con', this.effectsEngine.rules.length, 'regole');
        });

        this.roomService = new window.RoomService(
            this.database,
            this.firestore,
            this.validator,
            this.storageManager,
            this.errorHandler
        );

        this.diceService = new window.DiceService(
            this.validator,
            this.errorHandler,
            this.customDiceTypes,
            this.launchTypesRegistry
        );

        this.chatService = new window.ChatService(
            this.validator,
            this.errorHandler
        );

        this.presetManager = new window.PresetManager(this.firestore);

        this.extractionSystem = new window.ExtractionSystem(this.database);

        this.uiRenderer = new window.UIRenderer(
            this.validator,
            this.effectsEngine,
            this.launchTypesRegistry,
            this.colorTypesRegistry
        );

        this.initializeElements();
        this.bindEvents();
        this.initializeDefaultDiceRow();
        this.loadDiceRollerVisibility();
        this.loadCustomDiceTypes();
        this.loadPresets();
        this.setupPresetCollapse();
        this.initializeExtractionSystem();

        this.startCleanupInterval();
        this.storageManager.cleanupExpiredData();
    }

    initializeElements() {
        this.loginScreen = document.getElementById('loginScreen');
        this.gameScreen = document.getElementById('gameScreen');

        this.loginForm = document.getElementById('loginForm');
        this.playerNameInput = document.getElementById('playerName');
        this.roomCodeInput = document.getElementById('roomCode');

        this.currentRoomSpan = document.getElementById('currentRoom');
        this.leaveRoomBtn = document.getElementById('leaveRoom');
        this.cleanupUsersBtn = document.getElementById('cleanupUsers');
        this.headerUsersList = document.getElementById('headerUsersList');
        this.diceResults = document.getElementById('diceResults');
        this.chatMessages = document.getElementById('chatMessages');
        this.diceRows = document.getElementById('diceRows');
        this.addDiceBtn = document.getElementById('addDice');
        this.rollDiceBtn = document.getElementById('rollDice');
        this.chatInput = document.getElementById('chatInput');
        this.sendMessageBtn = document.getElementById('sendMessage');
        this.presetButtons = document.getElementById('presetButtons');

        this.extractionSection = document.getElementById('extractionSection');
        this.extractCardBtn = document.getElementById('extractCard');
        this.resetDeckBtn = document.getElementById('resetDeck');
        this.extractionRemaining = document.getElementById('extractionRemaining');
        this.extractionTotal = document.getElementById('extractionTotal');
        this.extractionProgress = document.getElementById('extractionProgress');
        this.extractionResult = document.getElementById('extractionResult');
    }

    bindEvents() {
        this.loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.joinRoom();
        });

        this.leaveRoomBtn.addEventListener('click', () => {
            this.leaveRoom();
        });

        this.cleanupUsersBtn.addEventListener('click', () => {
            this.cleanupDisconnectedUsers();
        });

        this.addDiceBtn.addEventListener('click', () => {
            this.addDiceRow();
        });

        this.rollDiceBtn.addEventListener('click', () => {
            this.rollAllDice();
        });

        this.sendMessageBtn.addEventListener('click', () => {
            this.sendChatMessage();
        });

        this.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendChatMessage();
            }
        });

        const clearChatBtn = document.getElementById('clearChat');
        const clearDiceResultsBtn = document.getElementById('clearDiceResults');

        if (clearChatBtn) {
            clearChatBtn.addEventListener('click', () => {
                this.clearChat();
            });
        }

        if (clearDiceResultsBtn) {
            clearDiceResultsBtn.addEventListener('click', () => {
                this.clearDiceResults();
            });
        }

        this.diceRows.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-dice')) {
                this.removeDiceRow(e.target.closest('.dice-input-group'));
            }
        });

        document.addEventListener('mousemove', (e) => {
            window.lastMouseX = e.clientX;
            window.lastMouseY = e.clientY;
            window.lastMouseTime = performance.now();
        });

        if (this.extractCardBtn) {
            this.extractCardBtn.addEventListener('click', () => {
                this.handleExtractCard();
            });
        }

        if (this.resetDeckBtn) {
            this.resetDeckBtn.addEventListener('click', () => {
                this.handleResetDeck();
            });
        }
    }

    setupPresetCollapse() {
        const presetSection = document.querySelector('.preset-section');
        if (!presetSection) return;

        const header = presetSection.querySelector('h3');
        if (!header) return;

        header.addEventListener('click', () => {
            presetSection.classList.toggle('collapsed');
        });
    }

    initializeDefaultDiceRow() {
        if (this.diceRows.children.length === 0) {
            this.addDiceRow();
        }
    }

    async loadDiceRollerVisibility() {
        this.fsEffectsConfigDoc.get().then((snap) => {
            const data = snap.exists ? snap.data() : {};
            this.diceRollerVisible = (data && data.diceRollerVisible !== false);
            this.updateDiceRollerVisibilityUI();
        }).catch((err) => {
            console.error('Errore lettura diceRollerVisible da Firestore:', err);
            this.diceRollerVisible = true;
            this.updateDiceRollerVisibilityUI();
        });

        this.fsEffectsConfigDoc.onSnapshot((snap) => {
            const data = snap.exists ? snap.data() : {};
            this.diceRollerVisible = (data && data.diceRollerVisible !== false);
            this.updateDiceRollerVisibilityUI();
        });
    }

    updateDiceRollerVisibilityUI() {
        const diceControls = document.querySelector('.dice-controls');
        if (diceControls) {
            diceControls.style.display = this.diceRollerVisible ? 'block' : 'none';
        }
    }

    async loadCustomDiceTypes(retryCount = 0) {
        const MAX_RETRIES = 2;
        const RETRY_DELAY = 1500;

        try {
            const snapshot = await this.fsCustomDiceTypesCol.get();
            const customDiceTypesData = {};

            snapshot.docs.forEach(doc => {
                customDiceTypesData[doc.id] = doc.data();
            });

            if (Object.keys(customDiceTypesData).length > 0) {
                this.customDiceTypes = customDiceTypesData;
            } else {
                this.customDiceTypes = {};
            }

            this.diceService.updateCustomDiceTypes(this.customDiceTypes);

            this.fsCustomDiceTypesCol.onSnapshot((snap) => {
                try {
                    const updatedData = {};
                    snap.docs.forEach(doc => {
                        updatedData[doc.id] = doc.data();
                    });
                    this.customDiceTypes = updatedData;
                    this.diceService.updateCustomDiceTypes(this.customDiceTypes);
                } catch (error) {
                    console.error('Errore snapshot dadi personalizzati:', error);
                }
            }, (error) => {
                console.error('Errore listener dadi personalizzati:', error);
            });
        } catch (error) {
            if (retryCount < MAX_RETRIES) {
                console.warn(`Tentativo ${retryCount + 1}/${MAX_RETRIES} caricamento dadi personalizzati...`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                return this.loadCustomDiceTypes(retryCount + 1);
            }

            const errorMsg = this.errorHandler.handleFirebaseError(error, 'loadCustomDiceTypes');
            console.error('Errore nel caricamento dei dadi custom:', errorMsg);
            this.customDiceTypes = {};
        }
    }

    async loadPresets() {
        try {
            await this.presetManager.loadPresets();
            this.renderPresets();

            this.presetManager.setupPresetListener(() => {
                this.renderPresets();
            });
        } catch (error) {
            console.error('Errore caricamento preset:', error);
            this.uiRenderer.showNotification('⚠️ Errore caricamento preset', 'warning');
        }
    }

    renderPresets() {
        try {
            const presets = this.presetManager.getPresets();
            if (!presets) {
                console.warn('Nessun preset disponibile');
                return;
            }

            this.uiRenderer.renderPresets(
                presets,
                this.presetButtons,
                this.customDiceTypes,
                (preset) => this.executePreset(preset)
            );
        } catch (error) {
            console.error('Errore rendering preset:', error);
        }
    }

    executePreset(preset) {
        if (!preset || !preset.dice || !Array.isArray(preset.dice)) {
            this.uiRenderer.showNotification('❌ Preset non valido', 'error');
            return;
        }

        this.presetManager.setCurrentPreset(preset);
        this.diceRows.innerHTML = '';

        preset.dice.forEach(dice => {
            const diceRow = document.createElement('div');
            diceRow.className = 'dice-input-group';

            const launchTypes = this.launchTypesRegistry.getAllTypes();
            let typeOptions = '';

            launchTypes.forEach(type => {
                if (type.category === 'numeric') {
                    type.variants.forEach(variant => {
                        const selected = (dice.type === variant.value || dice.type === parseInt(variant.value)) ? 'selected' : '';
                        typeOptions += `<option value="${variant.value}" data-launch-type="${type.id}" ${selected}>${variant.label}</option>`;
                    });
                } else if (type.category === 'array') {
                    const selected = (dice.type === type.id || dice.launchType === type.id) ? 'selected' : '';
                    typeOptions += `<option value="${type.id}" data-launch-type="${type.id}" ${selected}>${type.icon} ${type.name}</option>`;
                }
            });

            for (const [key, config] of Object.entries(this.customDiceTypes)) {
                const selected = dice.type === key ? 'selected' : '';
                typeOptions += `<option value="${key}" data-launch-type="custom" ${selected}>${config.label}</option>`;
            }

            const visibleColors = this.colorTypesRegistry.getVisibleColors();
            let colorOptions = '';
            visibleColors.forEach(color => {
                const selected = dice.color === color.id ? 'selected' : '';
                colorOptions += `<option value="${color.id}" ${selected}>${color.emoji} ${color.label}</option>`;
            });

            diceRow.innerHTML = `
                <select class="dice-count">
                    ${[...Array(window.CONSTANTS.LIMITS.MAX_DICE_PER_ROLL)].map((_, i) => {
                        const val = i + 1;
                        return `<option value="${val}" ${val === dice.count ? 'selected' : ''}>${val}</option>`;
                    }).join('')}
                </select>
                <span class="dice-separator">d</span>
                <select class="dice-type">
                    ${typeOptions}
                </select>
                <select class="dice-color">
                    ${colorOptions}
                </select>
                <button type="button" class="remove-dice">❌</button>
            `;

            this.diceRows.appendChild(diceRow);
        });

        const modifierInput = document.getElementById('diceModifier');
        if (modifierInput) {
            modifierInput.value = preset.modifier || 0;
        }

        const presetSection = document.querySelector('.preset-section');
        presetSection.style.animation = 'none';
        setTimeout(() => {
            presetSection.style.animation = '';
        }, window.CONSTANTS.TIMING.DICE_ROW_ANIMATION_DELAY_MS);

        this.uiRenderer.showNotification(`⚡ Preset "${preset.name}" caricato - Lancio automatico!`, 'success');

        setTimeout(() => {
            this.rollAllDice();
        }, window.CONSTANTS.TIMING.PRESET_AUTO_ROLL_DELAY_MS);
    }

    async joinRoom() {
        const nameValidation = this.validator.validatePlayerName(this.playerNameInput.value);
        if (!nameValidation.valid) {
            this.uiRenderer.showNotification(`❄️ ${nameValidation.error}`, 'error');
            return;
        }

        const codeValidation = this.validator.validateRoomCode(this.roomCodeInput.value);
        if (!codeValidation.valid) {
            this.uiRenderer.showNotification(`❄️ ${codeValidation.error}`, 'error');
            return;
        }

        const playerName = this.validator.escapeHtml(nameValidation.value);
        const roomCode = codeValidation.value;

        try {
            const result = await this.roomService.joinRoom(playerName, roomCode);

            if (!result || !result.roomCode) {
                throw new Error('Risposta non valida dal servizio room');
            }

            this.currentRoomSpan.textContent = result.roomCode;

            const roomRef = this.roomService.getRoomRef();

            if (!roomRef) {
                throw new Error('Impossibile ottenere il riferimento alla stanza. Riprova.');
            }

            this.diceResultsRef = roomRef.child('diceResults');

            if (!this.diceResultsRef) {
                throw new Error('Impossibile creare il riferimento ai risultati dadi.');
            }

            this.chatService.setupChatRef(roomRef);

            this.setupFirebaseListeners();
            this.updateDiceRollerVisibilityUI();
            this.showGameScreen();

            this.uiRenderer.showNotification(`🐺 Benvenuto nella taverna ${result.roomCode}!`, 'success');

        } catch (error) {
            console.error('❌ Errore joinRoom:', error);
            this.uiRenderer.showNotification(`❌ ${error.message}`, 'error');
        }
    }

    setupFirebaseListeners() {
        if (!this.roomService || !this.diceResultsRef) {
            console.error('setupFirebaseListeners: servizi non inizializzati');
            throw new Error('Servizi non inizializzati. Impossibile configurare i listener.');
        }

        try {
            this.roomService.setupFirebaseListeners((users) => {
                if (this.uiRenderer && this.headerUsersList) {
                    this.uiRenderer.renderUsersList(users, this.headerUsersList);
                }
            });
        } catch (error) {
            console.error('❌ Errore setupFirebaseListeners (roomService):', error);
            throw error;
        }

        this.diceResultsRef.limitToLast(window.CONSTANTS.LIMITS.DICE_RESULTS_HISTORY_LIMIT).once('value', (snapshot) => {
            if (!snapshot) return;

            const results = snapshot.val() || {};
            Object.values(results).forEach(result => {
                if (result && this.uiRenderer && this.diceResults) {
                    this.uiRenderer.addDiceResultToDisplay(result, this.diceResults, this.customDiceTypes);
                }
            });
        }).catch(error => {
            console.error('Errore caricamento storico dadi:', error);
        });

        const diceResultCallback = (snapshot) => {
            if (!snapshot) return;

            const result = snapshot.val();
            if (!result || !result.timestamp) return;

            const threshold = window.CONSTANTS.TIMING.DUPLICATE_RESULT_THRESHOLD_MS || 5000;
            if (result.timestamp > Date.now() - threshold) {
                if (this.uiRenderer && this.diceResults) {
                    this.uiRenderer.addDiceResultToDisplay(result, this.diceResults, this.customDiceTypes);
                }
            }
        };

        const limitedDiceRef = this.diceResultsRef.limitToLast(1);
        limitedDiceRef.on('child_added', diceResultCallback);
        this.listeners.push({ ref: limitedDiceRef, event: 'child_added', callback: diceResultCallback });

        if (this.chatService) {
            this.chatService.setupChatListener((message) => {
                if (message && this.uiRenderer && this.chatMessages) {
                    this.uiRenderer.addChatMessage(message, this.chatMessages);
                }
            });
        }
    }

    sendChatMessage() {
        try {
            const message = this.chatInput?.value;
            if (!message || message.trim() === '') {
                return;
            }

            const currentUser = this.roomService.getCurrentUser();
            if (!currentUser) {
                this.uiRenderer.showNotification('❌ Utente non valido', 'error');
                return;
            }

            this.chatService.sendMessage(message, currentUser);
            this.chatInput.value = '';

            this.sendMessageBtn.style.transform = `scale(${window.CONSTANTS.UI.BUTTON_SCALE_PRESSED})`;
            setTimeout(() => {
                this.sendMessageBtn.style.transform = 'scale(1)';
            }, window.CONSTANTS.TIMING.BUTTON_ANIMATION_DELAY_MS);
        } catch (error) {
            this.uiRenderer.showNotification(`❄️ ${error.message}`, 'error');
        }
    }

    addDiceRow() {
        this.presetManager.clearCurrentPreset();
        const diceRow = document.createElement('div');
        diceRow.className = 'dice-input-group';

        const launchTypes = this.launchTypesRegistry.getAllTypes();
        let typeOptions = '';

        launchTypes.forEach(type => {
            if (type.category === 'numeric') {
                type.variants.forEach(variant => {
                    const selected = variant.value === '6' ? 'selected' : '';
                    typeOptions += `<option value="${variant.value}" data-launch-type="${type.id}">${variant.label}</option>`;
                });
            } else if (type.category === 'array') {
                typeOptions += `<option value="${type.id}" data-launch-type="${type.id}">${type.icon} ${type.name}</option>`;
            }
        });

        for (const [key, config] of Object.entries(this.customDiceTypes)) {
            typeOptions += `<option value="${key}" data-launch-type="custom">${config.label}</option>`;
        }

        const visibleColors = this.colorTypesRegistry.getVisibleColors();
        let colorOptions = '';
        visibleColors.forEach(color => {
            colorOptions += `<option value="${color.id}">${color.emoji} ${color.label}</option>`;
        });

        diceRow.innerHTML = `
            <select class="dice-count">
                ${[...Array(window.CONSTANTS.LIMITS.MAX_DICE_PER_ROLL)].map((_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}
            </select>
            <span class="dice-separator">d</span>
            <select class="dice-type">
                ${typeOptions}
            </select>
            <select class="dice-color">
                ${colorOptions}
            </select>
            <button type="button" class="remove-dice">❌</button>
        `;

        this.diceRows.insertBefore(diceRow, this.diceRows.firstChild);

        diceRow.style.opacity = '0';
        diceRow.style.transform = `translateY(${window.CONSTANTS.UI.DICE_ROW_TRANSFORM_Y}px)`;
        setTimeout(() => {
            diceRow.style.transition = 'all 0.3s ease';
            diceRow.style.opacity = '1';
            diceRow.style.transform = 'translateY(0)';
        }, window.CONSTANTS.TIMING.DICE_ROW_ANIMATION_DELAY_MS);
    }

    removeDiceRow(row) {
        if (this.diceRows.children.length > 1) {
            row.style.transition = 'all 0.3s ease';
            row.style.opacity = '0';
            row.style.transform = `translateX(${window.CONSTANTS.UI.DICE_ROW_REMOVE_TRANSFORM_X}px)`;
            setTimeout(() => {
                row.remove();
            }, window.CONSTANTS.TIMING.DICE_ROW_REMOVE_DELAY_MS);
        } else {
            this.uiRenderer.showNotification('🎲 Devi avere almeno un dado!', 'warning');
        }
    }

    async rollAllDice() {
        if (this.diceService.isRolling) {
            console.warn('Lancio già in corso, ignorato');
            return;
        }

        try {
            // Assicurati che le regole siano caricate
            await this.effectsEngine.ensureConfigLoaded();

            const diceGroups = this.diceRows.querySelectorAll('.dice-input-group');
            if (!diceGroups || diceGroups.length === 0) {
                this.uiRenderer.showNotification('❌ Aggiungi almeno un dado!', 'error');
                return;
            }

            const currentUser = this.roomService.getCurrentUser();
            if (!currentUser) {
                this.uiRenderer.showNotification('❌ Utente non valido', 'error');
                return;
            }

            const presetRules = this.presetManager.getCurrentPreset()?.rules;

            const rollIcon = this.rollDiceBtn.querySelector('.roll-icon');
            const rollText = this.rollDiceBtn.querySelector('.roll-text');

            rollText.textContent = 'LANCIANDO...';
            this.rollDiceBtn.disabled = true;
            this.rollDiceBtn.style.animation = 'none';
            rollIcon.style.animation = 'spin 1s linear infinite';

            await this.animations.rollDice3D(this.rollDiceBtn, null, null);

            const rect = this.rollDiceBtn.getBoundingClientRect();
            this.animations.createRipple(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2
            );

            const diceResult = await this.diceService.rollDice(
                diceGroups,
                currentUser,
                presetRules && presetRules.length > 0 ? presetRules : null
            );

            if (diceResult && this.diceResultsRef) {
                await this.diceResultsRef.push(diceResult);
            }

            setTimeout(() => {
                rollText.textContent = 'LANCIA!';
                this.rollDiceBtn.disabled = false;
                this.rollDiceBtn.style.animation = 'rollPulse 3s ease-in-out infinite';
                rollIcon.style.animation = '';
            }, window.CONSTANTS.TIMING.DICE_ROLL_ANIMATION_MS);

        } catch (error) {
            const errorMsg = error?.message || 'Errore sconosciuto';
            this.uiRenderer.showNotification(`❌ ${errorMsg}`, 'error');

            if (this.rollDiceBtn) {
                this.rollDiceBtn.disabled = false;
                const rollText = this.rollDiceBtn.querySelector('.roll-text');
                if (rollText) rollText.textContent = 'LANCIA!';
            }

            if (this.diceService) {
                this.diceService.setRolling(false);
            }
        }
    }

    async initializeExtractionSystem() {
        try {
            const config = await this.extractionSystem.loadConfiguration();
            this.updateExtractionVisibility(config.visible);
            this.updateExtractionUI();
        } catch (error) {
            console.error('Errore inizializzazione sistema estrazione:', error);
        }
    }

    updateExtractionVisibility(visible) {
        if (this.extractionSection) {
            this.extractionSection.style.display = visible ? 'block' : 'none';
        }
    }

    updateExtractionUI() {
        const state = this.extractionSystem.getCurrentState();

        if (this.extractionRemaining) {
            this.extractionRemaining.textContent = state.remaining;
        }

        if (this.extractionTotal) {
            this.extractionTotal.textContent = state.totalCards;
        }

        if (this.extractionProgress) {
            this.extractionProgress.style.width = `${state.progress}%`;
        }

        if (this.extractCardBtn) {
            this.extractCardBtn.disabled = state.remaining === 0;
        }
    }

    handleExtractCard() {
        try {
            const result = this.extractionSystem.extractCard();

            if (this.extractionResult) {
                this.extractionResult.innerHTML = `<div class="extracted-card">${result.value}</div>`;
            }

            this.updateExtractionUI();

            if (result.remaining === 0) {
                this.uiRenderer.showNotification('Mazzo esaurito. Usa Reset per ricominciare.', 'warning');
            } else {
                this.uiRenderer.showNotification(`Estratto: ${result.value}`, 'success');
            }

        } catch (error) {
            this.uiRenderer.showNotification(error.message, 'error');
            console.error('Errore estrazione carta:', error);
        }
    }

    handleResetDeck() {
        try {
            const result = this.extractionSystem.resetDeck();

            if (this.extractionResult) {
                this.extractionResult.innerHTML = '<div class="result-placeholder">Clicca Estrai per pescare una carta</div>';
            }

            this.updateExtractionUI();
            this.uiRenderer.showNotification(result.message, 'success');

        } catch (error) {
            this.uiRenderer.showNotification('Errore reset mazzo', 'error');
            console.error('Errore reset mazzo:', error);
        }
    }

    startCleanupInterval() {
        setInterval(() => {
            this.validator.rateLimiter.cleanup();
            this.storageManager.cleanupExpiredData();
        }, window.CONSTANTS.TIMING.CLEANUP_INTERVAL_MS);

        setInterval(() => {
            const currentRoom = this.roomService.getCurrentRoom();
            if (currentRoom) {
                this.storageManager.cleanupOldDiceResults(this.database, currentRoom, window.CONSTANTS.LIMITS.MAX_DICE_RESULTS);
            }
        }, window.CONSTANTS.TIMING.DICE_RESULTS_CLEANUP_MS);
    }

    async clearChat() {
        if (confirm('🧹 Vuoi pulire la chat? Questa azione rimuoverà tutti i messaggi.')) {
            try {
                await this.chatService.clearAllMessages();
                this.chatMessages.innerHTML = '';
                this.uiRenderer.showNotification('🧹 Chat pulita!', 'success');
            } catch (error) {
                this.uiRenderer.showNotification('❌ Errore nella pulizia della chat', 'error');
                console.error('Errore clearChat:', error);
            }
        }
    }

    async clearDiceResults() {
        if (confirm('🧹 Vuoi pulire i risultati dei dadi?')) {
            try {
                if (this.diceResultsRef) {
                    await this.diceResultsRef.remove();
                }
                this.diceResults.innerHTML = '';
                this.uiRenderer.showNotification('🧹 Risultati dadi puliti!', 'success');
            } catch (error) {
                this.uiRenderer.showNotification('❌ Errore nella pulizia dei risultati', 'error');
                console.error('Errore clearDiceResults:', error);
            }
        }
    }

    async cleanupDisconnectedUsers() {
        try {
            const { removedCount } = await this.roomService.cleanupDisconnectedUsers();

            if (removedCount > 0) {
                this.uiRenderer.showNotification(`🧹 Rimossi ${removedCount} utenti inattivi`, 'success');
            } else {
                this.uiRenderer.showNotification('✅ Nessun utente inattivo da rimuovere', 'info');
            }
        } catch (error) {
            this.uiRenderer.showNotification(`❌ ${error.message}`, 'error');
        }
    }

    async leaveRoom() {
        if (confirm('🐺 Sei sicuro di voler abbandonare la taverna?')) {
            try {
                if (this.roomService) {
                    await this.roomService.removeUserFromRoom();
                    this.roomService.cleanup();
                }

                if (this.chatService) {
                    this.chatService.cleanup();
                }

                if (Array.isArray(this.listeners)) {
                    this.listeners.forEach(({ ref, event, callback }) => {
                        try {
                            if (ref && typeof ref.off === 'function') {
                                ref.off(event, callback);
                            }
                        } catch (error) {
                            console.warn('Errore rimozione listener:', error);
                        }
                    });
                }
                this.listeners = [];

                if (this.effectsEngine) {
                    this.effectsEngine.cleanup();
                }

                if (this.extractionSystem) {
                    this.extractionSystem.cleanup();
                }

                sessionStorage.removeItem('tavernaPlayerName');
                sessionStorage.removeItem('tavernaRoomCode');

                this.diceResultsRef = null;

                if (this.playerNameInput) this.playerNameInput.value = '';
                if (this.roomCodeInput) this.roomCodeInput.value = '';
                if (this.diceResults) this.diceResults.innerHTML = '';
                if (this.chatMessages) this.chatMessages.innerHTML = '';
                if (this.chatInput) this.chatInput.value = '';

                this.showLoginScreen();

                if (this.uiRenderer) {
                    this.uiRenderer.showNotification('🌙 Hai abbandonato la taverna. Che Odino ti protegga!', 'info');
                }
            } catch (error) {
                console.error('Errore durante uscita dalla stanza:', error);
                if (this.uiRenderer) {
                    this.uiRenderer.showNotification('❌ Errore durante uscita', 'error');
                }
            }
        }
    }

    showLoginScreen() {
        const rect = this.gameScreen.getBoundingClientRect();
        this.animations.createRipple(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2
        );

        setTimeout(() => {
            this.loginScreen.classList.add('active');
            this.gameScreen.classList.remove('active');
        }, window.CONSTANTS.TIMING.RIPPLE_DELAY_MS);
    }

    showGameScreen() {
        const rect = this.loginScreen.getBoundingClientRect();
        this.animations.createRipple(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2
        );

        setTimeout(() => {
            this.loginScreen.classList.remove('active');
            this.gameScreen.classList.add('active');
        }, window.CONSTANTS.TIMING.RIPPLE_DELAY_MS);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof firebase === 'undefined') {
        alert('❄️ Firebase non caricato. Controlla la connessione internet.');
        return;
    }

    if (!window.database) {
        alert('❄️ Firebase non configurato. Controlla firebase-config.js');
        return;
    }

    const app = new TavernaDeiCaniDiOdino();

    const savedPlayerName = sessionStorage.getItem('tavernaPlayerName');
    const savedRoomCode = sessionStorage.getItem('tavernaRoomCode');

    if (savedPlayerName && savedRoomCode) {
        app.playerNameInput.value = savedPlayerName;
        app.roomCodeInput.value = savedRoomCode;
        setTimeout(() => {
            app.joinRoom();
        }, 500);
    }
});

