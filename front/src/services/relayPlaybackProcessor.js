// Companion to pythonVoiceRelay.js: a small FIFO jitter buffer that plays
// back Float32 sample chunks delivered over the microphone relay WebSocket
// (see audio_relay_protocol.py on the backend) as they arrive via
// port.onmessage, instead of the usual microphone-driven audio graph input.
// A live duet is two people singing together, not a podcast -- letting the
// backlog climb toward a full second (the previous 48,000-sample cap) means
// the room partner hears the singer's voice up to ~1s late before this ever
// starts dropping anything. Losing a little audio to a brief stall is far
// less disruptive to live singing than that much added lag, so the cap is
// deliberately tight and computed from the worklet's actual sample rate
// rather than assuming 48kHz.
const MAX_QUEUED_SECONDS = 0.1;
const MAX_QUEUED_SAMPLES = Math.round(sampleRate * MAX_QUEUED_SECONDS);

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
