class DiceService {
    constructor(validator, errorHandler, customDiceTypes, launchTypesRegistry) {
        this.validator = validator;
        this.errorHandler = errorHandler;
        this.customDiceTypes = customDiceTypes;
        this.launchTypesRegistry = launchTypesRegistry;
        this.isRolling = false;
    }

    updateCustomDiceTypes(customDiceTypes) {
        this.customDiceTypes = customDiceTypes;
    }

    async rollDice(diceGroups, currentUser, presetRules = null) {
        if (this.isRolling) return null;

        if (!currentUser || !currentUser.id) {
            throw new Error('Utente non valido');
        }

        const rateLimitCheck = this.validator.rateLimiter.checkLimit(currentUser.id, 'roll');
        if (!rateLimitCheck.allowed) {
            throw new Error(rateLimitCheck.error);
        }

        this.isRolling = true;

        try {
            const results = [];

            diceGroups.forEach(group => {
                if (!group) return;

                const countSelect = group.querySelector('.dice-count');
                const typeSelect = group.querySelector('.dice-type');
                const colorSelect = group.querySelector('.dice-color');

                if (!countSelect || !typeSelect || !colorSelect) {
                    console.warn('Gruppo dadi incompleto saltato');
                    return;
                }

                const count = parseInt(countSelect.value) || 1;
                const type = typeSelect.value;
                const color = colorSelect.value;
                const launchTypeAttr = typeSelect.selectedOptions[0]?.dataset.launchType;

                for (let i = 0; i < count; i++) {
                    let value;
                    let sides;

                    if (this.customDiceTypes && this.customDiceTypes[type]) {
                        const customConfig = this.customDiceTypes[type];
                        const valuesArray = customConfig.values;

                        if (!Array.isArray(valuesArray) || valuesArray.length === 0) {
                            console.warn('Valori dado custom non validi:', type);
                            return;
                        }
                        const index = window.randomUtils.getSecureRandom(0, valuesArray.length - 1);
                        value = valuesArray[index];
                        sides = valuesArray.length;
                        results.push({
                            sides,
                            color,
                            value,
                            type: 'custom',
                            customType: type,
                            displayName: customConfig.displayName,
                            emoji: customConfig.emoji
                        });
                    } else if (launchTypeAttr && this.launchTypesRegistry) {
                        const launchType = this.launchTypesRegistry.getType(launchTypeAttr);

                        if (launchType && launchType.category === 'array') {
                            const index = window.randomUtils.getSecureRandom(0, launchType.values.length - 1);
                            value = launchType.values[index];
                            const emoji = launchType.emojis ? launchType.emojis[index] : launchType.icon;
                            results.push({
                                sides: launchType.values.length,
                                color,
                                value,
                                type: 'array',
                                launchType: launchTypeAttr,
                                displayName: launchType.name,
                                emoji: emoji,
                                index: index
                            });
                        } else {
                            sides = parseInt(type);
                            value = window.randomUtils.getSecureRandom(1, sides);
                            results.push({ sides, color, value, type: 'numeric' });
                        }
                    } else {
                        sides = parseInt(type);
                        value = window.randomUtils.getSecureRandom(1, sides);
                        results.push({ sides, color, value, type: 'numeric' });
                    }
                }
            });

            if (results.length === 0) return null;

            const now = Date.now();
            const diceResult = {
                playerName: currentUser.name,
                playerId: currentUser.id,
                results: results,
                timestamp: now,
                localTimestamp: now,
                color: currentUser.color,
                presetRules: presetRules
            };

            return diceResult;

        } catch (error) {
            const errorMsg = this.errorHandler.handleFirebaseError(error, 'rollAllDice');
            console.error('Errore nel lancio dadi:', errorMsg);
            throw new Error(errorMsg);
        } finally {
            setTimeout(() => {
                this.isRolling = false;
            }, window.CONSTANTS.TIMING.DICE_ROLL_ANIMATION_MS);
        }
    }

    setRolling(value) {
        this.isRolling = value;
    }
}

window.DiceService = DiceService;