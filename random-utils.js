class RandomUtils {
    constructor() {
        this.randomSeed = Date.now();
    }

    getSecureRandom(min, max) {
        const range = max - min + 1;
        const array = new Uint32Array(8);
        crypto.getRandomValues(array);

        const crypto1 = array[0];
        const crypto2 = array[1];
        const crypto3 = array[2];
        const crypto4 = array[3];
        const crypto5 = array[4];
        const crypto6 = array[5];
        const crypto7 = array[6];
        const crypto8 = array[7];

        const timestamp = Date.now();
        const performanceTime = typeof performance !== 'undefined' && performance.now
            ? Math.floor(performance.now() * 1000000)
            : Date.now() * 1000;

        const mathRandom1 = Math.floor(Math.random() * 0xFFFFFFFF);
        const mathRandom2 = Math.floor(Math.random() * 0xFFFFFFFF);
        const mathRandom3 = Math.floor(Math.random() * 0xFFFFFFFF);
        const mouseEntropy = (window.lastMouseX || 0) ^ (window.lastMouseY || 0) ^ (window.lastMouseTime || 0);
        const memoryEntropy = typeof performance !== 'undefined' && performance.memory
            ? performance.memory.usedJSHeapSize ^ performance.memory.totalJSHeapSize
            : 0;

        let combined = crypto1 ^ crypto2 ^ crypto3 ^ crypto4 ^
                       crypto5 ^ crypto6 ^ crypto7 ^ crypto8 ^
                       timestamp ^ performanceTime ^
                       mathRandom1 ^ mathRandom2 ^ mathRandom3 ^
                       mouseEntropy ^ memoryEntropy ^ this.randomSeed;

        combined = Math.imul(combined ^ (combined >>> 16), 0x85ebca6b);
        combined = Math.imul(combined ^ (combined >>> 13), 0xc2b2ae35);
        combined = (combined ^ (combined >>> 16)) >>> 0;

        combined = Math.imul(combined ^ (combined >>> 17), 0xed5ad4bb);
        combined = Math.imul(combined ^ (combined >>> 11), 0xac4c1b51);
        combined = (combined ^ (combined >>> 15)) >>> 0;

        combined = Math.imul(combined ^ (combined >>> 19), 0x6b54d32f);
        combined = Math.imul(combined ^ (combined >>> 12), 0x9e3779b9);
        combined = (combined ^ (combined >>> 14)) >>> 0;

        combined = Math.imul(combined ^ (combined >>> 21), 0xbf58476d);
        combined = Math.imul(combined ^ (combined >>> 10), 0x94d049bb);
        combined = (combined ^ (combined >>> 18)) >>> 0;

        const additionalMix = new Uint32Array(1);
        crypto.getRandomValues(additionalMix);
        combined = (combined ^ additionalMix[0]) >>> 0;

        const result = (combined % range) + min;
        this.randomSeed = combined;

        return result;
    }
}

window.RandomUtils = RandomUtils;
window.randomUtils = new RandomUtils();
