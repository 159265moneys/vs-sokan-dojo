const names = ["stone", "tap", "correct", "wrong", "win", "lose"];
export class Sounds {
  constructor() {
    this.enabled = true;
    this.buffers = new Map();
    this.context = null;
    this.loading = null;
  }
  async unlock() {
    if (!this.enabled) return;
    try {
      this.context ??= new (window.AudioContext || window.webkitAudioContext)();
      await this.context.resume();
      this.loading ??= Promise.all(
        names.map(async (name) => {
          const r = await fetch(
            new URL(`./audio/${name}.wav`, import.meta.url),
          );
          if (!r.ok) return;
          this.buffers.set(
            name,
            await this.context.decodeAudioData(await r.arrayBuffer()),
          );
        }),
      ).catch(() => {});
      await this.loading;
    } catch {}
  }
  async play(name) {
    if (!this.enabled) return;
    await this.unlock();
    if (!this.enabled || !this.buffers.has(name)) return;
    const source = this.context.createBufferSource(),
      gain = this.context.createGain();
    source.buffer = this.buffers.get(name);
    gain.gain.value = name === "tap" ? 0.5 : 0.7;
    source.connect(gain);
    gain.connect(this.context.destination);
    source.start();
  }
}
