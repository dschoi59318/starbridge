// netlify/functions/youtube.js
const https = require('https');

function firebaseGet(dbUrl, path) {
  return new Promise((resolve) => {
    const urlObj = new URL(`${dbUrl}/${path}.json`);
    const options = { hostname: urlObj.hostname, path: urlObj.pathname, method: 'GET' };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function firebasePut(dbUrl, path, data) {
  return new Promise((resolve) => {
    const body = JSON.stringify(data);
    const urlObj = new URL(`${dbUrl}/${path}.json`);
    const options = {
      hostname: urlObj.hostname, path: urlObj.pathname, method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(options, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(true));
    });
    req.on('error', () => resolve(false));
    req.write(body); req.end();
  });
}

function fetchYT(query, apiKey) {
  return new Promise((resolve, reject) => {
    const path = `/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&maxResults=3&key=${apiKey}`;
    const req = https.request({ hostname: 'www.googleapis.com', path, method: 'GET' }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(data) }); } catch(e) { reject(e); } });
    });
    req.on('error', reject); req.end();
  });
}

function cacheKey(q) { return q.replace(/[^a-zA-Z0-9가-힣]/g, '_').substring(0, 50); }

exports.handler = async function(event) {
  // ★ CORS 헤더 - 모든 응답에 포함
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Content-Type': 'application/json'
  };

  // OPTIONS preflight 요청 처리
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const q = event.queryStringParameters && event.queryStringParameters.q;
  if (!q) return { statusCode: 400, headers, body: JSON.stringify({ error: 'q 필요' }) };

  const API_KEY = process.env.YOUTUBE_API_KEY;
  const DB_URL = process.env.FIREBASE_DB_URL || 'https://choiproject1-96904467-caa4f-default-rtdb.asia-southeast1.firebasedatabase.app';

  if (!API_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'API키 없음' }) };

  const key = cacheKey(q);
  const CACHE_TTL = 24 * 60 * 60 * 1000;

  // 1. 캐시 확인
  try {
    const cached = await firebaseGet(DB_URL, `ytcache/${key}`);
    if (cached && cached.timestamp && (Date.now() - cached.timestamp) < CACHE_TTL) {
      return { statusCode: 200, headers, body: JSON.stringify({ items: cached.items, cached: true }) };
    }
  } catch(e) {}

  // 2. YouTube API 호출
  try {
    const { status, data } = await fetchYT(q, API_KEY);
    if (status !== 200) {
      return { statusCode: status, headers, body: JSON.stringify({ error: data.error && data.error.message || 'YT 오류' }) };
    }

    const items = (data.items || []).map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumb: item.snippet.thumbnails.high ? item.snippet.thumbnails.high.url : item.snippet.thumbnails.default.url,
      publishedAt: item.snippet.publishedAt
    }));

    if (items.length > 0) {
      try { await firebasePut(DB_URL, `ytcache/${key}`, { items, timestamp: Date.now(), query: q }); } catch(e) {}
    }

    return { statusCode: 200, headers, body: JSON.stringify({ items, cached: false }) };
  } catch(err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
