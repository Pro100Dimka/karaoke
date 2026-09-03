// Companion to pythonVoiceRelay.js: a small FIFO jitter buffer that plays
// back Float32 sample chunks delivered over the microphone relay WebSocket
// (see audio_relay_protocol.py on the backend) as they arrive via
// port.onmessage, instead of the usual microphone-driven audio graph input.
const MAX_QUEUED_SAMPLES = 48_000; // ~1s at 48kHz -- a generous backlog cap

class RelayPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.queuedSamples = 0;
    this.readOffset = 0;
    this.port.onmessage = ({ data }) => {
      if (!(data instanceof Float32Array) || !data.length) return;
      this.queue.push(data);
      this.queuedSamples += data.length;
      while (this.queuedSamples > MAX_QUEUED_SAMPLES && this.queue.length > 1) {
        this.queuedSamples -= this.queue.shift().length;
      }
    };
  }

  process(_inputs, outputs) {
    const channel = outputs[0]?.[0];
    if (!channel) return true;
    for (let index = 0; index < channel.length; index += 1) {
      const current = this.queue[0];
      if (!current) {
        channel[index] = 0;
        continue;
      }
      channel[index] = current[this.readOffset];
      this.readOffset += 1;
      this.queuedSamples -= 1;
      if (this.readOffset >= current.length) {
        this.queue.shift();
        this.readOffset = 0;
      }
    }
    return true;
  }
}

registerProcessor("advoice-relay-playback", RelayPlaybackProcessor);
