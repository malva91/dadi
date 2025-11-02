class ChatService {
    constructor(validator, errorHandler) {
        this.validator = validator;
        this.errorHandler = errorHandler;
        this.chatRef = null;
        this.listeners = [];
    }

    setupChatRef(roomRef) {
        if (!roomRef) {
            console.error('roomRef non valido per chat');
            return;
        }
        this.chatRef = roomRef.child('chat');
    }

    setupChatListener(onMessageAdded) {
        if (!this.chatRef) {
            console.warn('chatRef non inizializzato per listener');
            return;
        }

        const chatCallback = (snapshot) => {
            try {
                const message = snapshot.val();
                if (message && typeof onMessageAdded === 'function') {
                    onMessageAdded(message);
                }
            } catch (error) {
                console.error('Errore callback messaggio chat:', error);
                this.errorHandler.handleFirebaseError(error, 'chatCallback');
            }
        };

        const errorCallback = (error) => {
            console.error('Errore listener chat:', error);
            this.errorHandler.handleFirebaseError(error, 'chatListener');
        };

        const limitedRef = this.chatRef.limitToLast(window.CONSTANTS.LIMITS.CHAT_HISTORY_LIMIT);
        limitedRef.on('child_added', chatCallback, errorCallback);
        this.listeners.push({ ref: limitedRef, event: 'child_added', callback: chatCallback });
    }

    async sendMessage(messageText, currentUser, retryCount = 0) {
        const MAX_RETRIES = 2;
        const RETRY_DELAY = 500;

        if (!this.chatRef) {
            throw new Error('Chat non disponibile');
        }

        if (!currentUser || !currentUser.id) {
            throw new Error('Utente non valido');
        }

        const validation = this.validator.validateChatMessage(messageText);
        if (!validation.valid) {
            throw new Error(validation.error);
        }

        const rateLimitCheck = this.validator.rateLimiter.checkLimit(currentUser.id, 'chat');
        if (!rateLimitCheck.allowed) {
            throw new Error(rateLimitCheck.error);
        }

        const message = {
            playerName: currentUser.name,
            playerId: currentUser.id,
            text: validation.value,
            timestamp: Date.now(),
            color: currentUser.color
        };

        try {
            await this.chatRef.push(message);
            return message;
        } catch (error) {
            if (retryCount < MAX_RETRIES && this.isRetriableError(error)) {
                console.warn(`Tentativo invio messaggio ${retryCount + 1}/${MAX_RETRIES} fallito, riprovo...`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (retryCount + 1)));
                return this.sendMessage(messageText, currentUser, retryCount + 1);
            }

            const errorMsg = this.errorHandler.handleFirebaseError(error, 'sendMessage');
            console.error('Errore invio messaggio:', error);
            throw new Error(errorMsg);
        }
    }

    async clearAllMessages() {
        if (!this.chatRef) return;
        try {
            await this.chatRef.remove();
        } catch (error) {
            const errorMsg = this.errorHandler.handleFirebaseError(error, 'clearAllMessages');
            console.error('Errore nella cancellazione dei messaggi:', errorMsg);
            throw new Error(errorMsg);
        }
    }

    getChatRef() {
        return this.chatRef;
    }

    cleanup() {
        try {
            this.listeners.forEach(({ ref, event, callback }) => {
                if (ref) ref.off(event, callback);
            });
            this.listeners = [];

            if (this.chatRef) this.chatRef = null;
        } catch (error) {
            console.error('Errore cleanup ChatService:', error);
        }
    }

    isRetriableError(error) {
        if (!error) return false;
        const retriableCodes = [
            'NETWORK_ERROR',
            'DISCONNECTED',
            'UNAVAILABLE',
            'TIMEOUT'
        ];
        const code = (error.code || '').toUpperCase();
        return retriableCodes.some(retriable => code.includes(retriable));
    }
}

window.ChatService = ChatService;
