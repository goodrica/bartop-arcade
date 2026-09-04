/* ============================================
   Bartop Arcade - Audio Manager
   ============================================
   Procedural retro sound effects via Web Audio API.
   No asset files needed — all sounds are oscillator-based.
   ============================================ */

export class AudioManager {
  static #ctx = null;
  static #initialized = false;
  static #masterGain = null;

  static ensureInit() {
    if (this.#initialized) return;
    try {
      this.#ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.#masterGain = this.#ctx.createGain();
      this.#masterGain.gain.value = 0.3;
      this.#masterGain.connect(this.#ctx.destination);
      this.#initialized = true;
    } catch (e) {
      console.warn('Web Audio API not available');
    }
  }

  static #playTone(freq, duration, type = 'square', volume = 0.3) {
    if (!this.#initialized || !this.#ctx) return;
    const osc = this.#ctx.createOscillator();
    const gain = this.#ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.#ctx.currentTime);

    gain.gain.setValueAtTime(volume, this.#ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.#ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(this.#masterGain);

    osc.start(this.#ctx.currentTime);
    osc.stop(this.#ctx.currentTime + duration);
  }

  static #playSweep(startFreq, endFreq, duration, type = 'square', volume = 0.3) {
    if (!this.#initialized || !this.#ctx) return;
    const osc = this.#ctx.createOscillator();
    const gain = this.#ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, this.#ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(endFreq, this.#ctx.currentTime + duration);

    gain.gain.setValueAtTime(volume, this.#ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.#ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(this.#masterGain);

    osc.start(this.#ctx.currentTime);
    osc.stop(this.#ctx.currentTime + duration);
  }

  /** Short sharp click for menu navigation */
  static playClick() {
    this.#playTone(800, 0.08, 'square', 0.2);
  }

  /** Ascending tone — found a difference */
  static playCorrect() {
    this.#playTone(523, 0.1, 'square', 0.25);
    setTimeout(() => this.#playTone(659, 0.1, 'square', 0.25), 80);
    setTimeout(() => this.#playTone(784, 0.15, 'square', 0.25), 160);
  }

  /** Low buzz — wrong tap */
  static playWrong() {
    this.#playTone(120, 0.3, 'sawtooth', 0.2);
  }

  /** Metronome tick — time pressure */
  static playTick() {
    this.#playTone(1000, 0.03, 'square', 0.15);
  }

  /** Descending — game over */
  static playGameOver() {
    this.#playTone(600, 0.2, 'square', 0.25);
    setTimeout(() => this.#playTone(400, 0.2, 'square', 0.25), 200);
    setTimeout(() => this.#playTone(250, 0.3, 'square', 0.2), 400);
    setTimeout(() => this.#playTone(150, 0.5, 'sawtooth', 0.15), 600);
  }

  /** Cheerful arpeggio — victory */
  static playVictory() {
    const notes = [523, 659, 784, 1047, 784, 1047, 1319];
    notes.forEach((freq, i) => {
      setTimeout(() => this.#playTone(freq, 0.15, 'square', 0.25), i * 100);
    });
  }

  /** Short pop */
  static playPop() {
    this.#playTone(600, 0.06, 'sine', 0.2);
  }
}