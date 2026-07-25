import { regionMotion, WaveDetector } from './motion.js';

// Low-res local-only motion watcher. Frames never leave this function.
export async function createCamera({ onWave }) {
  const W = 160, H = 120;
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: W, height: H, frameRate: 15 },
  });
  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  await video.play();
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const detector = new WaveDetector();
  let prev = null;
  const timer = setInterval(() => {
    ctx.drawImage(video, 0, 0, W, H);
    const cur = ctx.getImageData(0, 0, W, H).data;
    if (prev) {
      const side = detector.push(regionMotion(prev, cur, W, H), performance.now());
      if (side) onWave(side);
    }
    prev = cur;
  }, 100);
  return {
    stop: () => { clearInterval(timer); stream.getTracks().forEach(t => t.stop()); },
  };
}
