// netlify/functions/youtube.js
// YouTube Data API v3 + Firebase 캐싱 (24시간)

const https = require('https');

// Firebase REST API로 데이터 읽기
function firebaseGet(dbUrl, path) {
  return new Promise((resolve, reject) => {
    const url = `${dbUrl}/${path}.json`;
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET'
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

// Firebase REST API로 데이터 쓰기
function firebasePut(dbUrl, path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const urlObj = new URL(`${dbUrl}/${path}.json`);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => resolve(true));
    });
    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
}

// 유튜브 API 호출
function fetchFromYoutube(query, apiKey) {
  return new Promise((resolve, reject) => {
    const path = `/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&maxResults=3&key=${apiKey}`;
    const options = {
      hostname: 'www.googleapis.com',
      path: path,
      method: 'GET'
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// 캐시 키 생성
function cacheKey(query) {
  return query.replace(/[^a-zA-Z0-9가-힣]/g, '_').substring(0, 50);
}

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const query = event.queryStringParameters && event.queryStringParameters.q;
  if (!query) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'q 파라미터 필요' }) };
  }

  const API_KEY = process.env.YOUTUBE_API_KEY;
  const DB_URL = process.env.FIREBASE_DB_URL || 'https://choiproject1-96904467-caa4f-default-rtdb.asia-southeast1.firebasedatabase.app';

  if (!API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'API 키 없음' }) };
  }

  const key = cacheKey(query);
  const CACHE_TTL = 24 * 60 * 60 * 1000; // 24시간

  // 1. Firebase 캐시 확인
  try {
    const cached = await firebaseGet(DB_URL, `ytcache/${key}`);
    if (cached && cached.timestamp && (Date.now() - cached.timestamp) < CACHE_TTL) {
      console.log(`캐시 히트: ${query}`);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ items: cached.items, cached: true })
      };
    }
  } catch(e) {
    console.log('캐시 읽기 실패:', e.message);
  }

  // 2. YouTube API 호출
  console.log(`YouTube API 호출: ${query}`);
  try {
    const { status, data } = await fetchFromYoutube(query, API_KEY);

    if (status !== 200) {
      return {
        statusCode: status,
        headers,
        body: JSON.stringify({ error: data.error && data.error.message || 'YouTube API 오류' })
      };
    }

    const items = (data.items || []).map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumb: item.snippet.thumbnails.high
        ? item.snippet.thumbnails.high.url
        : item.snippet.thumbnails.default.url,
      publishedAt: item.snippet.publishedAt
    }));

    // 3. Firebase에 캐시 저장
    if (items.length > 0) {
      try {
        await firebasePut(DB_URL, `ytcache/${key}`, {
          items,
          timestamp: Date.now(),
          query
        });
        console.log(`캐시 저장 완료: ${query}`);
      } catch(e) {
        console.log('캐시 저장 실패:', e.message);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ items, cached: false })
    };

  } catch(err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
