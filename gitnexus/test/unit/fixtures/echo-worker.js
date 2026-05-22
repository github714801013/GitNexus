import { parentPort } from 'node:worker_threads';

const items = [];

parentPort.on('message', (msg) => {
  if (msg.type === 'sub-batch') {
    items.push(...msg.files);
    parentPort.postMessage({ type: 'progress', filesProcessed: items.length });
    parentPort.postMessage({ type: 'sub-batch-done' });
  } else if (msg.type === 'flush') {
    parentPort.postMessage({ type: 'result', data: items });
  }
});
