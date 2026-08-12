// Audio Context Singleton
let audioCtx: AudioContext | null = null;
let bgmGainNode: GainNode | null = null;
let sfxGainNode: GainNode | null = null;
let bgmSource: AudioBufferSourceNode | null = null;
let isMuted = false;
let currentBgmVolume = 0.3;
let currentSfxVolume = 0.5;
let successSfxBufferPromise: Promise<AudioBuffer | null> | null = null;
const successSfxGain = 0.2;

const initAudio = () => {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        bgmGainNode = audioCtx.createGain();
        sfxGainNode = audioCtx.createGain();

        bgmGainNode.connect(audioCtx.destination);
        sfxGainNode.connect(audioCtx.destination);

        bgmGainNode.gain.value = 0.3; // Lower volume for BGM
        sfxGainNode.gain.value = 0.5;
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
};

const playAudioFile = (path: string) => {
    const ctx = initAudio();
    if (!ctx || !sfxGainNode) return;

    if (!successSfxBufferPromise) {
        successSfxBufferPromise = fetch(path)
            .then(response => {
                if (!response.ok) throw new Error(`Audio request failed: ${response.status}`);
                return response.arrayBuffer();
            })
            .then(arrayBuffer => ctx.decodeAudioData(arrayBuffer))
            .catch(error => {
                console.error(`Failed to load SFX: ${path}`, error);
                return null;
            });
    }

    void successSfxBufferPromise.then(buffer => {
        if (!buffer || !sfxGainNode) return;
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        source.buffer = buffer;
        gain.gain.value = successSfxGain;
        source.connect(gain);
        gain.connect(sfxGainNode);
        source.start();
    });
};

export const audioManager = {
    init: () => {
        initAudio();
    },

    toggleMute: () => {
        if (!audioCtx || !bgmGainNode || !sfxGainNode) return isMuted;

        isMuted = !isMuted;
        const now = audioCtx.currentTime;

        if (isMuted) {
            bgmGainNode.gain.setTargetAtTime(0, now, 0.1);
            sfxGainNode.gain.setTargetAtTime(0, now, 0.1);
        } else {
            bgmGainNode.gain.setTargetAtTime(currentBgmVolume, now, 0.1);
            sfxGainNode.gain.setTargetAtTime(currentSfxVolume, now, 0.1);
        }
        return isMuted;
    },

    setBGMVolume: (volume: number) => {
        currentBgmVolume = Math.max(0, Math.min(1, volume));
        if (bgmGainNode && !isMuted) {
            bgmGainNode.gain.setTargetAtTime(currentBgmVolume, audioCtx!.currentTime, 0.1);
        }
    },

    setSFXVolume: (volume: number) => {
        currentSfxVolume = Math.max(0, Math.min(1, volume));
        if (sfxGainNode && !isMuted) {
            sfxGainNode.gain.setTargetAtTime(currentSfxVolume, audioCtx!.currentTime, 0.1);
        }
    },

    suspend: () => {
        if (audioCtx && audioCtx.state === 'running') {
            audioCtx.suspend();
        }
    },

    resume: () => {
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    },

    getVolumes: () => ({ bgm: currentBgmVolume, sfx: currentSfxVolume }),

    playBGM: async () => {
        const ctx = initAudio();
        if (!ctx || !bgmGainNode || bgmSource) return;

        try {
            const response = await fetch('/bgm2.mp3');
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

            bgmSource = ctx.createBufferSource();
            bgmSource.buffer = audioBuffer;
            bgmSource.loop = true;
            bgmSource.connect(bgmGainNode);
            bgmSource.start();
        } catch (error) {
            console.error("Failed to load BGM:", error);
        }
    },

    playSFX: (type: 'plop' | 'coin' | 'breed' | 'click' | 'purchase' | 'eat' | 'success') => {
        const ctx = initAudio();
        if (!ctx || !sfxGainNode) return;

        if (type === 'success') {
            playAudioFile('/success.mp3');
            return;
        }

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(sfxGainNode);

        const now = ctx.currentTime;

        switch (type) {
            case 'eat':
                // Cute Pop / Munch sound
                osc.type = 'sine';
                osc.frequency.setValueAtTime(800, now);
                osc.frequency.exponentialRampToValueAtTime(200, now + 0.1);
                gain.gain.setValueAtTime(0.3, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
                osc.start(now);
                osc.stop(now + 0.1);
                break;

            case 'plop':
                osc.type = 'sine';
                osc.frequency.setValueAtTime(300, now);
                osc.frequency.exponentialRampToValueAtTime(50, now + 0.2);
                gain.gain.setValueAtTime(1, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
                osc.start(now);
                osc.stop(now + 0.2);
                break;

            case 'coin':
                osc.type = 'sine';
                osc.frequency.setValueAtTime(1200, now);
                osc.frequency.setValueAtTime(1600, now + 0.1);
                gain.gain.setValueAtTime(0.5, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
                osc.start(now);
                osc.stop(now + 0.3);
                break;

            case 'breed':
                // Arpeggio
                [440, 554, 659, 880].forEach((freq, i) => {
                    const o = ctx.createOscillator();
                    const g = ctx.createGain();
                    o.connect(g);
                    g.connect(sfxGainNode!);

                    o.type = 'sine';
                    o.frequency.value = freq;

                    const start = now + i * 0.1;
                    g.gain.setValueAtTime(0, start);
                    g.gain.linearRampToValueAtTime(0.3, start + 0.05);
                    g.gain.exponentialRampToValueAtTime(0.01, start + 1.0);

                    o.start(start);
                    o.stop(start + 1.0);
                });
                break;

            case 'purchase':
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(600, now);
                osc.frequency.linearRampToValueAtTime(1000, now + 0.1);
                gain.gain.setValueAtTime(0.5, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
                osc.start(now);
                osc.stop(now + 0.4);
                break;

            case 'click':
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(800, now);
                gain.gain.setValueAtTime(0.2, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
                osc.start(now);
                osc.stop(now + 0.05);
                break;
        }
    }
};
