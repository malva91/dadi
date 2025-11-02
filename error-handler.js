class ErrorHandler {
    constructor() {
        this.errors = [];
        this.maxErrors = window.CONSTANTS.LIMITS.MAX_STORED_ERRORS;
        this.setupGlobalHandlers();
    }

    setupGlobalHandlers() {
        window.addEventListener('error', (event) => {
            this.logError({
                type: 'javascript',
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                stack: event.error?.stack,
                timestamp: Date.now()
            });
        });

        window.addEventListener('unhandledrejection', (event) => {
            this.logError({
                type: 'promise',
                message: event.reason?.message || String(event.reason),
                stack: event.reason?.stack,
                timestamp: Date.now()
            });
        });
    }

    logError(error) {
        console.error('[ErrorHandler]', error);

        this.errors.push(error);

        if (this.errors.length > this.maxErrors) {
            this.errors.shift();
        }
    }

    handleFirebaseError(error, context = '') {
        const errorMessage = this.getFirebaseErrorMessage(error);

        this.logError({
            type: 'firebase',
            context,
            code: error.code,
            message: errorMessage,
            originalMessage: error.message,
            timestamp: Date.now()
        });

        return errorMessage;
    }

    getFirebaseErrorMessage(error) {
        const errorMessages = {
            'PERMISSION_DENIED': 'Permessi insufficienti per accedere ai dati',
            'NETWORK_ERROR': 'Errore di connessione. Controlla la tua rete',
            'DISCONNECTED': 'Connessione persa. Riconnessione in corso...',
            'MAX_RETRIES': 'Troppi tentativi falliti. Riprova più tardi',
            'INVALID_TOKEN': 'Sessione scaduta. Ricarica la pagina',
            'UNAVAILABLE': 'Servizio temporaneamente non disponibile'
        };

        const code = error.code || '';

        for (const [key, message] of Object.entries(errorMessages)) {
            if (code.includes(key)) {
                return message;
            }
        }

        return error.message || 'Errore sconosciuto';
    }

    getErrors(limit = 10) {
        return this.errors.slice(-limit);
    }

    clearErrors() {
        this.errors = [];
    }

    createFallbackUI(message) {
        const fallback = document.createElement('div');
        fallback.className = 'error-fallback';
        fallback.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(139, 69, 19, 0.95);
            color: white;
            padding: 2rem;
            border-radius: 10px;
            border: 2px solid var(--bronze);
            text-align: center;
            z-index: 10000;
            box-shadow: 0 0 30px rgba(0, 0, 0, 0.5);
        `;

        fallback.innerHTML = `
            <h2 style="margin: 0 0 1rem 0; color: var(--gold);">⚠️ Errore</h2>
            <p style="margin: 0 0 1.5rem 0;">${message}</p>
            <button onclick="location.reload()" style="
                background: var(--steel-blue);
                color: white;
                border: none;
                padding: 0.8rem 1.5rem;
                border-radius: 5px;
                cursor: pointer;
                font-weight: 600;
            ">Ricarica Pagina</button>
        `;

        document.body.appendChild(fallback);
        return fallback;
    }
}

window.ErrorHandler = ErrorHandler;
