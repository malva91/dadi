class LaunchTypesRegistry {
    constructor() {
        this.types = new Map();
        this.initializeDefaultTypes();
    }

    initializeDefaultTypes() {
        this.registerType({
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
            ],
            roller: (sides) => {
                return window.randomUtils.getSecureRandom(1, sides);
            }
        });

        this.registerType({
            id: 'coin',
            name: 'Moneta',
            icon: '🪙',
            category: 'array',
            values: ['Testa', 'Croce'],
            emojis: ['👤', '⚔️'],
            displayFormat: (value, index) => `${this.types.get('coin').emojis[index]} ${value}`
        });

        this.registerType({
            id: 'boolean',
            name: 'Vero/Falso',
            icon: '✓',
            category: 'array',
            values: ['Vero', 'Falso'],
            emojis: ['✅', '❌'],
            displayFormat: (value, index) => `${this.types.get('boolean').emojis[index]} ${value}`
        });

        this.registerType({
            id: 'bestemmie',
            name: 'Bestemmie',
            icon: '👴',
            category: 'array',
            values: ["Dio Cinghiale 🐗",
                "Dio Lupo 🐺",
                "Dio Falco 🦅",
                "Dio Serpente lurido 🐍",
                "Dio Grifone bstardo 🦁🦅",
                "Dio Cane 🐶",
                "Dio Cavallo al galoppo 🐴",
                "Dio Gufo 🦉",
                "Dio verme 🪱",
                "Dio maiale 🐷",
                "Madonna Lepre 🐇",
                "Madonna Gatta 🐈",
                "Madonna Volpe 🦊",
                "Madonna Cerva 🦌",
                "Madonna Civetta 🦉",
                "Madonna Cane 🐶",
                "Madonna Oca 🦢",
                "Madonna a Pecora 🐑",
                "Madonna Cinghiale 🐗",
                "Madonna Lupa 🐺",
                "Madonna Maiala 🐷"],
            displayFormat: (value, index) => `${this.types.get('bestemmie').emojis[index]} ${value}`
        });

        this.registerType({
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
            ],
            displayFormat: (value, index) => `${this.types.get('runes').emojis[index]} ${value}`
        });


        this.registerType({
            id: 'tarot',
            name: 'Arcani Tarocchi',
            icon: '🃏',
            category: 'array',
            values: [
                'Il Matto', 'Il Mago', 'La Papessa', 'L\'Imperatrice',
                'L\'Imperatore', 'Il Papa', 'Gli Amanti', 'Il Carro'
            ],
            emojis: ['🃏', '🎩', '📿', '👑', '⚜️', '✝️', '💕', '🏇'],
            displayFormat: (value, index) => `${this.types.get('tarot').emojis[index]} ${value}`
        });

        this.registerType({
            id: 'element',
            name: 'Elementi',
            icon: '🔥',
            category: 'array',
            values: ['Fuoco', 'Acqua', 'Terra', 'Aria'],
            emojis: ['🔥', '💧', '🌍', '💨'],
            displayFormat: (value, index) => `${this.types.get('element').emojis[index]} ${value}`
        });
    }

    registerType(config) {
        if (!config.id || !config.name || !config.category) {
            throw new Error('Launch type must have id, name, and category');
        }

        if (config.category === 'numeric' && !config.variants) {
            throw new Error('Numeric launch types must have variants');
        }

        if (config.category === 'array' && !config.values) {
            throw new Error('Array launch types must have values');
        }

        this.types.set(config.id, config);
    }

    getType(id) {
        return this.types.get(id);
    }

    getAllTypes() {
        return Array.from(this.types.values());
    }

    getTypesByCategory(category) {
        return this.getAllTypes().filter(type => type.category === category);
    }

    roll(typeId, variant = null) {
        const type = this.getType(typeId);
        if (!type) {
            throw new Error(`Launch type ${typeId} not found`);
        }

        if (type.category === 'numeric') {
            if (type.roller) {
                const sides = variant || type.variants[0].sides;
                return type.roller(sides);
            }
        } else if (type.category === 'array') {
            const randomIndex = window.randomUtils.getSecureRandom(0, type.values.length - 1);
            return {
                value: type.values[randomIndex],
                index: randomIndex,
                emoji: type.emojis ? type.emojis[randomIndex] : '',
                display: type.displayFormat ? type.displayFormat(type.values[randomIndex], randomIndex) : type.values[randomIndex]
            };
        }

        throw new Error(`Invalid category for type ${typeId}`);
    }

    removeType(id) {
        return this.types.delete(id);
    }
}

window.LaunchTypesRegistry = LaunchTypesRegistry;
