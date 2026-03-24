/**
 * 실시간 멀티플레이 경마 게임 - Node.js 백엔드
 * Render 배포 시 PORT 환경변수 사용, Socket.io Room으로 로비 관리
 */

require('dotenv').config();

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');
const path = require('path');

function newRaceId() {
  return crypto.randomUUID();
}

const app = express();
const server = http.createServer(app);

// Render 등 배포 환경에서는 process.env.PORT 사용
const PORT = process.env.PORT || 3000;

// 한글 깨짐 방지: 텍스트 응답은 UTF-8 charset을 명시
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
  } else if (req.path.endsWith('.js')) {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  } else if (req.path.endsWith('.css')) {
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
  } else if (req.path.endsWith('.json')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  next();
});

// Netlify 등 다른 도메인에서 Render API(/api/*) 호출 가능하도록 CORS 허용
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// 정적 파일: 로컬/통합 테스트 시 루트에서 index.html 제공. Netlify 배포 시 프론트는 Netlify에서 서빙.
app.use(express.static(__dirname));
// crowd.png 직접 경로 (캐시 방지용)
app.get('/crowd.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'crowd.png'), (err) => {
    if (err) res.status(404).end();
  });
});

const io = new Server(server, {
  // Netlify(다른 Origin) → Render(WebSocket) 연결에서 CORS/Origin 관련 이슈를 최소화
  cors: {
    origin: (origin, cb) => cb(null, true),
    methods: ['GET', 'POST'],
    credentials: false
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// ========== 방·플레이어 상태 ==========
const TARGET_DISTANCE = 8000;
const COLORS = ['red', 'blue', 'green', 'yellow'];
const MAX_PLAYERS_PER_ROOM = COLORS.length;
const WAITING_COUNTDOWN_SECONDS = 30;
const DEFAULT_TRACK_ID = 'single_track';
const rooms = new Map(); // roomId -> { players: Map, status, countdownTimer, currentObstacles, createdAt }
const bestTimesMem = new Map(); // nickname -> { nickname, finishTimeSec, updatedAt, trackId }

function generateObstacles() {
  // 장애물은 항상 최대 2개.
  // 첫 장애물: 1000m 이상 구간에서 랜덤 (대략 1000~3500m 사이).
  // 두 번째 장애물: 5000m 이상 구간에서 랜덤 (대략 5000~7500m 사이).
  const result = [];

  const firstMin = 1000;
  const firstMax = Math.max(firstMin + 500, Math.floor(TARGET_DISTANCE * 0.45)); // 예: 3600m 정도
  const secondMin = 5000;
  const secondMax = TARGET_DISTANCE - 800; // 결승선 직전은 비워두기

  // 첫 번째 장애물 (항상 생성)
  const x1 = firstMin + Math.floor(Math.random() * Math.max(1, firstMax - firstMin));
  result.push({
    type: Math.random() < 0.5 ? 'hurdle' : 'water',
    x: x1
  });

  // 두 번째 장애물 (항상 생성) – 5000m 이후에서 랜덤
  const x2 = secondMin + Math.floor(Math.random() * Math.max(1, secondMax - secondMin));
  result.push({
    type: Math.random() < 0.5 ? 'hurdle' : 'water',
    x: x2
  });

  return result;
}

function getPlayersInRoom(room) {
  if (!room) return [];
  return Array.from(room.players.entries()).map(([id, data]) => ({
    id,
    nickname: data.nickname,
    color: data.color,
    isHost: data.isHost
  }));
}

function getUsedColors(room) {
  if (!room) return new Set();
  return new Set([...room.players.values()].map(p => p.color).filter(Boolean));
}

function assignRandomColor(room) {
  const used = getUsedColors(room);
  const available = COLORS.filter((c) => !used.has(c));
  if (available.length === 0) return null;
  const i = crypto.randomInt(0, available.length);
  return available[i];
}

function isHost(room, socketId) {
  return !!room && room.players.get(socketId)?.isHost === true;
}

function setNewHost(room) {
  const list = getPlayersInRoom(room);
  if (!room || list.length === 0) return null;
  const firstId = list[0].id;
  room.players.forEach((data, id) => {
    data.isHost = id === firstId;
  });
  return firstId;
}

function stopCountdown(room) {
  if (!room) return;
  if (room.countdownTimer) {
    clearInterval(room.countdownTimer);
    room.countdownTimer = null;
  }
}

function createRoom() {
  const roomId = `room_${crypto.randomUUID().slice(0, 8)}`;
  const room = {
    id: roomId,
    players: new Map(),
    status: 'waiting', // waiting | started
    countdownTimer: null,
    currentObstacles: [],
    winnerSocketId: null,
    createdAt: Date.now()
  };
  rooms.set(roomId, room);
  return room;
}

function findJoinableWaitingRoom() {
  const candidates = [];
  rooms.forEach((room) => {
    if (room.status !== 'waiting') return;
    if (room.players.size >= MAX_PLAYERS_PER_ROOM) return;
    candidates.push(room);
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.createdAt - b.createdAt);
  return candidates[0];
}

function startGameForRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'waiting') return;
  stopCountdown(room);
  room.status = 'started';
  room.currentObstacles = generateObstacles();
  room.winnerSocketId = null;
  io.to(roomId).emit('game_start', {
    players: getPlayersInRoom(room),
    obstacles: room.currentObstacles,
    raceId: newRaceId()
  });
}

function startCountdown(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'waiting') return;
  stopCountdown(room);
  let sec = WAITING_COUNTDOWN_SECONDS;
  io.to(roomId).emit('countdown', sec);
  room.countdownTimer = setInterval(() => {
    const r = rooms.get(roomId);
    if (!r || r.status !== 'waiting') {
      if (r) stopCountdown(r);
      return;
    }
    sec--;
    io.to(roomId).emit('countdown', sec);
    if (sec <= 0) {
      startGameForRoom(roomId);
    }
  }, 1000);
}

// ========== Supabase (선택) ==========
// .env 또는 환경변수에 SUPABASE_URL, SUPABASE_SERVICE_KEY 설정 후 사용. supabase-schema.sql 실행 필요.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

async function updateWinCount(nickname) {
  if (!supabase) return;
  try {
    const { error } = await supabase.rpc('increment_wins', { p_nickname: nickname });
    if (error) console.warn('Supabase update:', error.message);
  } catch (e) {
    console.warn('Supabase error:', e.message);
  }
}

/** 결승 도착 기록 (레이스당 말 색상별 1행, upsert) */
async function saveRaceTimeRecord(payload) {
  if (!supabase) return;
  try {
    const { raceId, color, nickname, rank, finishTimeSec } = payload || {};
    if (!raceId || !color) return;
    const row = {
      race_id: String(raceId),
      color: String(color),
      nickname: String(nickname || '').slice(0, 40),
      rank: rank != null ? Math.floor(Number(rank)) : 0,
      finish_time_sec: finishTimeSec != null ? Number(finishTimeSec) : null
    };
    const { error } = await supabase.from('race_results').upsert(row, {
      onConflict: 'race_id,color'
    });
    if (error) console.warn('Supabase race_results:', error.message);
  } catch (e) {
    console.warn('Supabase race_results:', e.message);
  }
}

function updateBestTimeInMemory({ nickname, finishTimeSec, trackId = DEFAULT_TRACK_ID }) {
  if (!nickname || typeof finishTimeSec !== 'number' || !Number.isFinite(finishTimeSec) || finishTimeSec <= 0) return;
  const key = String(nickname).trim().slice(0, 40);
  if (!key) return;
  const prev = bestTimesMem.get(key);
  if (!prev || finishTimeSec < prev.finishTimeSec) {
    bestTimesMem.set(key, {
      nickname: key,
      finishTimeSec,
      updatedAt: Date.now(),
      trackId
    });
  }
}

function getTopTimesFromMemory(limit = 3, trackId = DEFAULT_TRACK_ID) {
  const rows = [...bestTimesMem.values()]
    .filter((r) => !trackId || r.trackId === trackId)
    .sort((a, b) => a.finishTimeSec - b.finishTimeSec || a.updatedAt - b.updatedAt)
    .slice(0, limit)
    .map((r) => ({ nickname: r.nickname, finishTimeSec: r.finishTimeSec }));
  return rows;
}

async function getTopTimes(limit = 3, trackId = DEFAULT_TRACK_ID) {
  if (!supabase) return getTopTimesFromMemory(limit, trackId);
  try {
    // race_results에서 닉네임별 최소 기록을 뽑아 상위 3개를 반환
    const { data, error } = await supabase
      .from('race_results')
      .select('nickname, finish_time_sec')
      .not('finish_time_sec', 'is', null)
      .order('finish_time_sec', { ascending: true })
      .limit(300);
    if (error) throw error;
    const bestByName = new Map();
    (data || []).forEach((row) => {
      const name = String(row.nickname || '').trim();
      const t = Number(row.finish_time_sec);
      if (!name || !Number.isFinite(t) || t <= 0) return;
      const prev = bestByName.get(name);
      if (prev == null || t < prev) bestByName.set(name, t);
    });
    const top = [...bestByName.entries()]
      .map(([nickname, finishTimeSec]) => ({ nickname, finishTimeSec }))
      .sort((a, b) => a.finishTimeSec - b.finishTimeSec)
      .slice(0, limit);
    if (top.length > 0) {
      top.forEach((r) => updateBestTimeInMemory({ ...r, trackId }));
      return top;
    }
  } catch (e) {
    console.warn('Supabase top-times:', e.message);
  }
  return getTopTimesFromMemory(limit, trackId);
}

app.get('/api/top-times', async (req, res) => {
  try {
    const trackId = String(req.query.trackId || DEFAULT_TRACK_ID);
    const limitRaw = Number(req.query.limit || 3);
    const limit = Math.max(1, Math.min(10, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 3));
    const top = await getTopTimes(limit, trackId);
    res.json({ trackId, top });
  } catch (e) {
    res.status(500).json({ message: 'top-times 조회 실패' });
  }
});

// ========== Socket.io ==========
io.on('connection', (socket) => {
  socket.on('set_nickname', (nickname) => {
    socket.nickname = (nickname || '').trim().slice(0, 20) || 'Player';
  });

  socket.on('create_or_join', () => {
    const nickname = socket.nickname || 'Player';
    // 중복 호출 시 색을 다시 뽑지 않음(클라이언트 재전송·레이스 방지)
    if (socket.roomId && rooms.has(socket.roomId)) {
      const room = rooms.get(socket.roomId);
      const ex = room && room.players ? room.players.get(socket.id) : null;
      if (!ex) {
        socket.roomId = null;
      } else {
      socket.emit('your_info', {
        id: socket.id,
        nickname: ex.nickname,
        color: ex.color,
        isHost: ex.isHost,
        players: getPlayersInRoom(room),
        roomId: socket.roomId
      });
      return;
      }
    }
    let room = findJoinableWaitingRoom();
    if (!room) room = createRoom();
    const isFirst = room.players.size === 0;
    const color = assignRandomColor(room);
    if (!color) {
      socket.emit('error', { message: '방이 가득 찼습니다.' });
      return;
    }
    socket.join(room.id);
    socket.roomId = room.id;
    room.players.set(socket.id, {
      nickname,
      color,
      isHost: isFirst
    });
    socket.emit('your_info', {
      id: socket.id,
      nickname,
      color,
      isHost: isFirst,
      players: getPlayersInRoom(room),
      roomId: room.id
    });
    socket.to(room.id).emit('player_list', getPlayersInRoom(room));
    if (isFirst) startCountdown(room.id);
  });

  socket.on('leave_room', () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    const wasHost = isHost(room, socket.id);
    socket.leave(roomId);
    room.players.delete(socket.id);
    socket.roomId = null;
    if (room.players.size === 0) {
      stopCountdown(room);
      rooms.delete(roomId);
      return;
    }
    if (room.status === 'waiting' && wasHost) {
      setNewHost(room);
      startCountdown(roomId); // 방장 교체 시 30초 재대기
    }
    io.to(roomId).emit('player_list', getPlayersInRoom(room));
  });

  socket.on('start_game', () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    if (!isHost(room, socket.id)) return;
    if (room.status !== 'waiting') return;
    startGameForRoom(roomId);
  });

  socket.on('horse_move', (data) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    const me = room.players.get(socket.id);
    if (!me || !me.color) return;
    const payload = {
      color: me.color,
      x: data.x,
      nickname: me.nickname
    };
    if (data && data.finishTimeSec != null && typeof data.finishTimeSec === 'number') {
      payload.finishTimeSec = data.finishTimeSec;
    }
    io.to(roomId).emit('horse_position', payload);
  });

  socket.on('race_time_record', (payload) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    const me = room.players.get(socket.id);
    if (!me || !payload || !payload.raceId || !payload.color) return;
    const allowed = isHost(room, socket.id) || me.color === payload.color;
    if (!allowed) return;
    saveRaceTimeRecord(payload);
    updateBestTimeInMemory({
      nickname: payload.nickname || me.nickname,
      finishTimeSec: payload.finishTimeSec,
      trackId: payload.trackId || DEFAULT_TRACK_ID
    });
  });

  socket.on('player_finished', (data) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    const me = room.players.get(socket.id);
    if (!me) return;
    const finishTimeSec =
      data && typeof data.finishTimeSec === 'number' ? data.finishTimeSec : null;
    // 방 단위 최초 도착자만 우승자로 확정
    if (room.winnerSocketId) return;
    room.winnerSocketId = socket.id;
    io.to(roomId).emit('race_finished', {
      winnerNickname: me.nickname,
      winnerColor: me.color,
      isWinner: true,
      finishTimeSec
    });
    updateBestTimeInMemory({
      nickname: me.nickname,
      finishTimeSec,
      trackId: (data && data.trackId) || DEFAULT_TRACK_ID
    });
    updateWinCount(me.nickname);
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    const wasHost = isHost(room, socket.id);
    socket.leave(roomId);
    room.players.delete(socket.id);
    socket.roomId = null;
    if (room.players.size === 0) {
      stopCountdown(room);
      rooms.delete(roomId);
      return;
    }
    if (room.status === 'waiting' && wasHost) {
      setNewHost(room);
      startCountdown(roomId); // 방장 교체 시 30초 재대기
    }
    io.to(roomId).emit('player_list', getPlayersInRoom(room));
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Open in browser: http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`\n[ERROR] Port ${PORT} is already in use.`);
    console.error('Close the other program using this port, or run with a different port:');
    console.error('  Windows CMD:  set PORT=3001 && npm start');
    console.error('  PowerShell:   $env:PORT=3001; npm start\n');
  } else {
    console.error('[ERROR] Server failed to start:', err && err.message ? err.message : err);
  }
  process.exit(1);
});
