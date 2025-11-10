/**
 * ConfigRegistry - Sistema centralizzato per tutte le configurazioni
 *
 * COME AGGIUNGERE NUOVE CONFIGURAZIONI:
 *
 * 1. PALETTE COLORI:
 *    Aggiungi in COLOR_PALETTE array
 *
 * 2. DICE COLORS:
 *    Aggiungi in DICE_COLORS array con { id, label, emoji, visible }
 *
 * 3. LAUNCH TYPES:
 *    Aggiungi in LAUNCH_TYPES array con configurazione completa
 *
 * 4. NOTIFICATION TYPES:
 *    Aggiungi in NOTIFICATION_TYPES con colore e icona
 */

class ConfigRegistry {
    constructor() {
        this.config = this.getDefaultConfig();
        this.listeners = new Map();
        this.initialized = false;
    }

    getDefaultConfig() {
        return {
            // PALETTE COLORI - Aggiungi qui nuovi colori per gli utenti
            COLOR_PALETTE: [
                '#8B3A3A', '#3A3A8B', '#3A8B3A', '#8B8B3A',
                '#8B5A3A', '#6B3A6B', '#3A8B8B', '#8B3A5A',
                '#5A5A5A', '#704040', '#8B4040', '#408B40',
                '#40408B', '#8B408B', '#608060', '#806080',
                '#608080', '#805050', '#505080', '#805060'
            ],

            // DICE COLORS - Aggiungi qui nuovi tipi di colore dadi
            DICE_COLORS: [
                { id: 'base', label: 'Base', emoji: '🎲', visible: true },
                { id: 'rosso', label: 'Rosso', emoji: '🔴', visible: true },
                { id: 'blu', label: 'Blu', emoji: '🔵', visible: true },
                { id: 'danni', label: 'Danni', emoji: '⚔️', visible: true },
                { id: 'protezione', label: 'Protezione', emoji: '🛡️', visible: true },
                { id: 'cura', label: 'Cura', emoji: '❤️', visible: true }
            ],

            // LAUNCH TYPES - Aggiungi qui nuovi tipi di lancio
            LAUNCH_TYPES: [
                {
                    id: 'dice',
                    name: 'Dadi Classici',
                    icon: '🎲',
                    category: 'numeric',
                    variants: [
                        { value: '4', label: 'D4', sides: 4 },
                        { value: '6', label: 'D6', sides: 6 },
                        { value: '8', label: 'D8', sides: 8 },
                        { value: '10', label: 'D10', sides: 10 },
                        { value: '12', label: 'D12', sides: 12 },
                        { value: '20', label: 'D20', sides: 20 },
                        { value: '100', label: 'D100', sides: 100 }
                    ]
                },
                {
                    id: 'coin',
                    name: 'Moneta',
                    icon: '🪙',
                    category: 'array',
                    values: ['Testa', 'Croce'],
                    emojis: ['👤', '⚔️']
                },
                {
                    id: 'boolean',
                    name: 'Vero/Falso',
                    icon: '✓',
                    category: 'array',
                    values: ['Vero', 'Falso'],
                    emojis: ['✅', '❌']
                },
                {
                    id: 'runes',
                    name: 'Rune Nordiche',
                    icon: 'ᚠ',
                    category: 'array',
                    values: [
                        'Fehu', 'Uruz', 'Thurisaz', 'Ansuz', 'Raidho', 'Kenaz',
                        'Gebo', 'Wunjo', 'Hagalaz', 'Nauthiz', 'Isa', 'Jera',
                        'Eihwaz', 'Perthro', 'Algiz', 'Sowilo', 'Tiwaz', 'Berkano',
                        'Ehwaz', 'Mannaz', 'Laguz', 'Ingwaz', 'Dagaz', 'Othala'
                    ],
                    emojis: [
                        'ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ',
                        'ᚷ', 'ᚹ', 'ᚺ', 'ᚾ', 'ᛁ', 'ᛃ',
                        'ᛇ', 'ᛈ', 'ᛉ', 'ᛊ', 'ᛏ', 'ᛒ',
                        'ᛖ', 'ᛗ', 'ᛚ', 'ᛝ', 'ᛞ', 'ᛟ'
                    ]
                },
                {
                    id: 'tarot',
                    name: 'Arcani Tarocchi',
                    icon: '🃏',
                    category: 'array',
                    values: [
                        'Il Matto', 'Il Mago', 'La Papessa', 'L\'Imperatrice',
                        'L\'Imperatore', 'Il Papa', 'Gli Amanti', 'Il Carro'
                    ],
                    emojis: ['🃏', '🎩', '📿', '👑', '⚜️', '✝️', '💕', '🏇']
                },
                {
                    id: 'element',
                    name: 'Elementi',
                    icon: '🔥',
                    category: 'array',
                    values: ['Fuoco', 'Acqua', 'Terra', 'Aria'],
                    emojis: ['🔥', '💧', '🌍', '💨']
                }
            ],

            // NOTIFICATION TYPES - Aggiungi qui nuovi tipi di notifica
            NOTIFICATION_TYPES: {
                success: { color: 'var(--steel-blue)', icon: '✅' },
                error: { color: '#8b4513', icon: '❌' },
                warning: { color: '#b8860b', icon: '⚠️' },
                info: { color: 'var(--ice-blue)', icon: 'ℹ️' }
            },

            // TAG COLORS - Aggiungi qui nuovi colori per i tag dei preset
            TAG_COLORS: {
                attacco: '#ffe5e5',
                difesa: '#e5f0ff',
                magia: '#f4e5ff',
                cura: '#e6ffef',
                loot: '#fff7e5',
                default: '#f2f4f7'
            },

            // EFFECT TYPES - Tipi di effetti disponibili
            EFFECT_TYPES: {
                particles: [
                    'particles-gold', 'particles-rainbow', 'particles-fire',
                    'particles-ice', 'particles-green', 'particles-purple'
                ],
                smoke: [
                    'smoke-dark', 'smoke-colored', 'smoke-spiral', 'smoke-explosion'
                ],
                glow: [
                    'glow-gold', 'glow-blue', 'glow-green', 'glow-purple',
                    'glow-rainbow', 'glow-red', 'glow-red-pulse', 'glow-intense'
                ],
                window: [
                    'bounce', 'bounce-high', 'spin', 'spin-fast',
                    'scale-pulse', 'flip', 'shake', 'shake-hard', 'wobble'
                ]
            }
        };
    }

    // Inizializza i registry esistenti con la configurazione centralizzata
    initializeRegistries() {
        if (this.initialized) return;

        // Inizializza ColorTypesRegistry
        if (window.ColorTypesRegistry) {
            const colorRegistry = new window.ColorTypesRegistry();
            colorRegistry.colors.clear();
            this.config.DICE_COLORS.forEach(color => {
                colorRegistry.registerColor(color);
            });
            window.colorTypesRegistry = colorRegistry;
        }

        // Inizializza LaunchTypesRegistry
        if (window.LaunchTypesRegistry) {
            const launchRegistry = new window.LaunchTypesRegistry();
            launchRegistry.types.clear();
            this.config.LAUNCH_TYPES.forEach(type => {
                launchRegistry.registerType(type);
            });
            window.launchTypesRegistry = launchRegistry;
        }

        this.initialized = true;
    }

    // Ottieni una configurazione specifica
    get(key) {
        return this.config[key];
    }

    // Aggiungi un listener per cambiamenti di configurazione
    onChange(key, callback) {
        if (!this.listeners.has(key)) {
            this.listeners.set(key, []);
        }
        this.listeners.get(key).push(callback);
    }

    // Aggiorna una configurazione e notifica i listener
    update(key, value) {
        this.config[key] = value;
        if (this.listeners.has(key)) {
            this.listeners.get(key).forEach(callback => callback(value));
        }
    }

    // Aggiungi un elemento a un array di configurazione
    addToArray(key, item) {
        if (!Array.isArray(this.config[key])) {
            console.error(`${key} is not an array`);
            return false;
        }
        this.config[key].push(item);
        this.update(key, this.config[key]);
        return true;
    }

    // Rimuovi un elemento da un array di configurazione
    removeFromArray(key, predicate) {
        if (!Array.isArray(this.config[key])) {
            console.error(`${key} is not an array`);
            return false;
        }
        this.config[key] = this.config[key].filter(item => !predicate(item));
        this.update(key, this.config[key]);
        return true;
    }

    // Reset a valori di default
    reset() {
        this.config = this.getDefaultConfig();
        this.initializeRegistries();
    }
}

// Crea istanza globale
window.ConfigRegistry = ConfigRegistry;
window.configRegistry = new ConfigRegistry();

// Auto-inizializza quando il DOM è pronto
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.configRegistry.initializeRegistries();
    });
} else {
    window.configRegistry.initializeRegistries();
}
