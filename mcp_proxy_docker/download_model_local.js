import { pipeline, env } from '@huggingface/transformers';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 设置本地下载目录
const modelId = 'Xenova/bge-small-zh-v1.5';
const cacheDir = path.join(__dirname, 'models');

env.cacheDir = cacheDir;
env.localModelPath = cacheDir;
env.allowRemoteModels = true;
// 本地可以使用镜像站加速
env.remoteHost = 'https://hf-mirror.com';

console.log(`Downloading model ${modelId} to ${cacheDir}...`);

async function download() {
    try {
        await pipeline('feature-extraction', modelId, {
            cache_dir: cacheDir,
        });
        console.log('Model downloaded successfully to local folder!');
        process.exit(0);
    } catch (error) {
        console.error('Download failed:', error);
        process.exit(1);
    }
}

download();
