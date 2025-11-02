class StorageManager {
    constructor() {
        const { STORAGE } = window.CONSTANTS;
        this.TTL_DAYS = STORAGE.TTL_DAYS;
        this.STORAGE_PREFIX = STORAGE.PREFIX;
    }

    setUserData(roomCode, userId, userColor) {
        const timestamp = Date.now();
        const expiryDate = timestamp + (this.TTL_DAYS * 24 * 60 * 60 * 1000);

        localStorage.setItem(`${this.STORAGE_PREFIX}${roomCode}_userId`, userId);
        localStorage.setItem(`${this.STORAGE_PREFIX}${roomCode}_userColor`, userColor);
        localStorage.setItem(`${this.STORAGE_PREFIX}${roomCode}_expiry`, expiryDate.toString());
    }

    getUserData(roomCode) {
        const userId = localStorage.getItem(`${this.STORAGE_PREFIX}${roomCode}_userId`);
        const userColor = localStorage.getItem(`${this.STORAGE_PREFIX}${roomCode}_userColor`);
        const expiry = localStorage.getItem(`${this.STORAGE_PREFIX}${roomCode}_expiry`);

        if (!userId || !expiry) {
            return null;
        }

        const expiryTimestamp = parseInt(expiry);
        const now = Date.now();

        if (now > expiryTimestamp) {
            this.clearUserData(roomCode);
            return null;
        }

        return { userId, userColor, expiry: expiryTimestamp };
    }

    clearUserData(roomCode) {
        localStorage.removeItem(`${this.STORAGE_PREFIX}${roomCode}_userId`);
        localStorage.removeItem(`${this.STORAGE_PREFIX}${roomCode}_userColor`);
        localStorage.removeItem(`${this.STORAGE_PREFIX}${roomCode}_expiry`);
    }

    cleanupExpiredData() {
        const now = Date.now();
        const keysToRemove = [];

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);

            if (key && key.startsWith(this.STORAGE_PREFIX) && key.endsWith('_expiry')) {
                const expiryValue = localStorage.getItem(key);
                const expiryTimestamp = parseInt(expiryValue);

                if (now > expiryTimestamp) {
                    const roomCode = key.replace(this.STORAGE_PREFIX, '').replace('_expiry', '');
                    keysToRemove.push(roomCode);
                }
            }
        }

        keysToRemove.forEach(roomCode => this.clearUserData(roomCode));

        return keysToRemove.length;
    }

    cleanupOldDiceResults(database, roomCode, maxResults = 100) {
        const diceResultsRef = database.ref(`rooms/${roomCode}/diceResults`);

        return diceResultsRef.once('value').then(snapshot => {
            const results = snapshot.val();
            if (!results) return 0;

            const resultsArray = Object.entries(results).map(([key, value]) => ({
                key,
                timestamp: value.timestamp
            }));

            resultsArray.sort((a, b) => b.timestamp - a.timestamp);

            if (resultsArray.length <= maxResults) {
                return 0;
            }

            const toDelete = resultsArray.slice(maxResults);
            const deletePromises = toDelete.map(result =>
                diceResultsRef.child(result.key).remove()
            );

            return Promise.all(deletePromises).then(() => toDelete.length);
        });
    }

    cleanupInactiveUsers(database, roomCode, timeoutHours = 24) {
        const usersRef = database.ref(`rooms/${roomCode}/users`);
        const now = Date.now();
        const timeout = timeoutHours * 60 * 60 * 1000;

        return usersRef.once('value').then(snapshot => {
            const users = snapshot.val();
            if (!users) return 0;

            const deletePromises = [];
            let count = 0;

            for (const [userId, user] of Object.entries(users)) {
                if (now - user.lastSeen > timeout) {
                    deletePromises.push(usersRef.child(userId).remove());
                    count++;
                }
            }

            return Promise.all(deletePromises).then(() => count);
        });
    }
}

window.StorageManager = StorageManager;
