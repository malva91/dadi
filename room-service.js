class RoomService {
    constructor(database, firestore, validator, storageManager, errorHandler) {
        this.database = database;
        this.firestore = firestore;
        this.validator = validator;
        this.storageManager = storageManager;
        this.errorHandler = errorHandler;
        this.currentRoom = null;
        this.currentUser = null;
        this.roomRef = null;
        this.usersRef = null;
        this.heartbeatInterval = null;
        this.listeners = [];
    }

    async joinRoom(playerName, roomCode, retryCount = 0) {
        const MAX_RETRIES = 3;
        const RETRY_DELAY = 1000;

        const rateLimitCheck = this.validator.rateLimiter.checkLimit('join_' + roomCode, 'join');
        if (!rateLimitCheck.allowed) {
            throw new Error(rateLimitCheck.error);
        }

        try {
            if (!this.database) {
                throw new Error('Database non inizializzato. Verifica la connessione a Firebase.');
            }

            const userData = this.storageManager.getUserData(roomCode);
            let savedUserId = userData?.userId;
            let savedUserColor = userData?.userColor;

            if (!savedUserId) {
                savedUserId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            }

            this.currentRoom = roomCode;
            this.roomRef = this.database.ref(`rooms/${roomCode}`);

            if (!this.roomRef) {
                throw new Error('Impossibile creare riferimento alla stanza. Verifica la configurazione Firebase.');
            }

            this.usersRef = this.roomRef.child('users');

            if (!this.usersRef) {
                throw new Error('Impossibile creare riferimento agli utenti. Verifica la configurazione Firebase.');
            }

            const usersSnapshot = await this.usersRef.once('value');
            const users = usersSnapshot.val() || {};

            let userColor = savedUserColor;

            if (!userColor) {
                if (users[savedUserId] && users[savedUserId].color) {
                    userColor = users[savedUserId].color;
                } else {
                    userColor = this.assignUniqueColor(users, savedUserId);
                }
            }

            this.storageManager.setUserData(roomCode, savedUserId, userColor);

            this.currentUser = {
                id: savedUserId,
                name: playerName,
                joinedAt: Date.now(),
                lastSeen: Date.now(),
                color: userColor
            };

            sessionStorage.setItem('tavernaPlayerName', playerName);
            sessionStorage.setItem('tavernaRoomCode', roomCode);

            await this.usersRef.child(this.currentUser.id).set(this.currentUser);

            return { user: this.currentUser, roomCode };

        } catch (error) {
            if (retryCount < MAX_RETRIES && this.isRetriableError(error)) {
                console.warn(`Tentativo ${retryCount + 1}/${MAX_RETRIES} fallito, riprovo...`, error.code);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (retryCount + 1)));
                return this.joinRoom(playerName, roomCode, retryCount + 1);
            }

            const errorMsg = this.errorHandler.handleFirebaseError(error, 'joinRoom');
            console.error('Errore nell\'accesso alla stanza:', error);
            throw new Error(errorMsg);
        }
    }

    setupFirebaseListeners(onUsersUpdate) {
        if (!this.usersRef) {
            const errorMsg = '❌ usersRef non inizializzato - impossibile configurare i listener';
            console.error(errorMsg);
            console.error('Debug info:', {
                database: !!this.database,
                roomRef: !!this.roomRef,
                currentRoom: this.currentRoom,
                currentUser: this.currentUser
            });
            throw new Error('Riferimento utenti non inizializzato. Impossibile entrare nella stanza.');
        }

        if (!this.usersRef.on || typeof this.usersRef.on !== 'function') {
            const errorMsg = '❌ usersRef.on non è una funzione - Firebase non correttamente inizializzato';
            console.error(errorMsg);
            console.error('usersRef type:', typeof this.usersRef);
            console.error('usersRef:', this.usersRef);
            throw new Error('Firebase non correttamente inizializzato. Ricarica la pagina.');
        }

        this.cleanupListeners();

        const usersCallback = (snapshot) => {
            try {
                if (!snapshot) return;

                const users = snapshot.val() || {};
                if (typeof onUsersUpdate === 'function') {
                    onUsersUpdate(users);
                }

                if (Object.keys(users).length === 0 && this.roomRef) {
                    this.roomRef.remove().catch(err => {
                        console.warn('Errore rimozione stanza vuota:', err);
                    });
                }
            } catch (error) {
                console.error('Errore callback aggiornamento utenti:', error);
                this.errorHandler.handleFirebaseError(error, 'setupFirebaseListeners');
            }
        };

        const errorCallback = (error) => {
            console.error('Errore listener Firebase:', error);
            this.errorHandler.handleFirebaseError(error, 'firebaseListener');
        };

        this.usersRef.on('value', usersCallback, errorCallback);
        this.listeners.push({ ref: this.usersRef, event: 'value', callback: usersCallback });

        if (this.currentUser && this.currentUser.id) {
            try {
                this.usersRef.child(this.currentUser.id).onDisconnect().remove();
            } catch (error) {
                console.error('Errore configurazione onDisconnect:', error);
            }
        }

        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        this.heartbeatInterval = setInterval(() => {
            if (this.usersRef && this.currentUser && this.currentUser.id) {
                this.usersRef.child(this.currentUser.id).update({
                    lastSeen: Date.now()
                }).catch(err => {
                    console.warn('Errore heartbeat:', err);
                });
            }
        }, window.CONSTANTS.TIMING.HEARTBEAT_INTERVAL_MS || 30000);
    }

    assignUniqueColor(users, currentUserId) {
        const colorsInUse = Object.values(users)
            .filter(u => u.id !== currentUserId)
            .map(u => u.color);

        const availableColors = window.CONSTANTS.COLOR_PALETTE.filter(c => !colorsInUse.includes(c));

        if (availableColors.length === 0) {
            const idx = window.randomUtils.getSecureRandom(0, window.CONSTANTS.COLOR_PALETTE.length - 1);
            return window.CONSTANTS.COLOR_PALETTE[idx];
        }

        const idx = window.randomUtils.getSecureRandom(0, availableColors.length - 1);
        return availableColors[idx];
    }

    async cleanupDisconnectedUsers() {
        if (!this.usersRef || !this.currentUser) {
            return { removedCount: 0 };
        }

        try {
            const snapshot = await this.usersRef.once('value');
            const users = snapshot.val() || {};
            const now = Date.now();
            let removedCount = 0;

            for (const [userId, user] of Object.entries(users)) {
                if (!user || userId === this.currentUser.id) continue;

                const lastSeen = user.lastSeen || 0;
                const timeout = window.CONSTANTS.TIMING.DISCONNECT_TIMEOUT_MS || 300000;

                if (now - lastSeen > timeout) {
                    try {
                        await this.usersRef.child(userId).remove();
                        removedCount++;
                    } catch (error) {
                        console.warn(`Errore rimozione utente ${userId}:`, error);
                    }
                }
            }

            return { removedCount };
        } catch (error) {
            const errorMsg = this.errorHandler.handleFirebaseError(error, 'cleanupDisconnectedUsers');
            console.error('Errore nella pulizia utenti:', errorMsg);
            throw new Error(errorMsg);
        }
    }

    async removeUserFromRoom() {
        if (this.usersRef && this.currentUser && this.currentUser.id) {
            try {
                if (this.currentRoom && this.storageManager) {
                    this.storageManager.clearUserData(this.currentRoom);
                }
                await this.usersRef.child(this.currentUser.id).remove();
            } catch (error) {
                console.error('Errore nella rimozione utente:', error);
                if (this.errorHandler) {
                    this.errorHandler.handleFirebaseError(error, 'removeUserFromRoom');
                }
            }
        }
    }

    cleanupListeners() {
        if (Array.isArray(this.listeners)) {
            this.listeners.forEach(({ ref, event, callback }) => {
                try {
                    if (ref && typeof ref.off === 'function') {
                        ref.off(event, callback);
                    }
                } catch (error) {
                    console.warn('Errore cleanup listener:', error);
                }
            });
        }
        this.listeners = [];

        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    cleanup() {
        this.cleanupListeners();

        this.usersRef = null;
        this.roomRef = null;
        this.currentUser = null;
        this.currentRoom = null;
    }

    getRoomRef() {
        return this.roomRef;
    }

    getCurrentUser() {
        return this.currentUser;
    }

    getCurrentRoom() {
        return this.currentRoom;
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

window.RoomService = RoomService;
