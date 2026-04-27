const apiKey = 'sk-oS0AUaRLvSTUDy1MoMPjxA';
const url = 'https://dashscope.ch999.cn/base/v1/embeddings';
const model = 'text-embedding-v4';
const input = ['test', '', 'another test'];

async function test() {
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ input, model, encoding_format: 'float' }),
    });
    console.log('Status:', resp.status);
    const data = await resp.json();
    if (data.data && data.data[0]) {
        console.log('Data Type of embedding:', typeof data.data[0].embedding);
        if (typeof data.data[0].embedding === 'string') {
            console.log('Sample content (split by space):', data.data[0].embedding.split(' ').slice(0, 3));
        } else if (Array.isArray(data.data[0].embedding)) {
            console.log('Sample content (array):', data.data[0].embedding.slice(0, 3));
        }
    } else {
        console.log('No data returned:', JSON.stringify(data));
    }
  } catch (err) {
    console.error('Error:', err);
  }
}
test();
