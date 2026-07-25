import { TransientDetector } from './transient-detector.js';

const WORKLET_SRC = `
class Forwarder extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('forwarder', Forwarder);
`;

export async function createEngine({ deviceId, sensitivity = 6, onFrame, onLevel, onChunk }) {
  const constraints = {
    audio: {
      ...(deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
    },
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(url);
  const node = new AudioWorkletNode(ctx, 'forwarder');
  const detector = new TransientDetector({ sampleRate: ctx.sampleRate, threshold: sensitivity });
  detector.onFrame = frame => onFrame(frame, ctx.sampleRate);
  let levelAcc = 0, levelN = 0, lastLevelAt = 0;
  node.port.onmessage = e => {
    detector.push(e.data);
    if (onChunk) onChunk(e.data, ctx.sampleRate);
    if (!onLevel) return;
    let s = 0;
    for (let i = 0; i < e.data.length; i++) s += e.data[i] * e.data[i];
    levelAcc += s; levelN += e.data.length;
    const now = performance.now();
    if (now - lastLevelAt > 50 && levelN > 0) {
      onLevel(Math.sqrt(levelAcc / levelN));
      levelAcc = 0; levelN = 0; lastLevelAt = now;
    }
  };
  src.connect(node);
  // worklet needs a sink to run; route through zero-gain so nothing is audible
  const mute = ctx.createGain(); mute.gain.value = 0;
  node.connect(mute).connect(ctx.destination);
  return {
    sampleRate: ctx.sampleRate,
    stop: () => { node.port.onmessage = null; stream.getTracks().forEach(t => t.stop()); ctx.close(); },
  };
}
