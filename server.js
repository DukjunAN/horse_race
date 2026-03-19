/**
 * 실시간 멀티플레이 경마 게임 - Node.js 백엔드
 * Render 배포 시 PORT 환경변수 사용, Socket.io Room으로 로비 관리
 */

require('dotenv').config();

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Render 등 배포 환경에서는 process.env.PORT 사용
const PORT = process.env.PORT || 3000;

// 정적 파일: 로컬/통합 테스트 시 루트에서 index.html 제공. Netlify 배포 시 프론트는 Netlify에서 서빙.
app.use(express.static(__dirname));
// crowd.png 직접 경로 (캐시 방지용)
app.get('/crowd.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'crowd.png'), (err) => {
    if (err) res.status(404).end();
  });
});

const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000
});

// ========== 방·플레이어 상태 ==========
const TARGET_DISTANCE = 8000;
const ROOM_ID = 'lobby';
const COLORS = ['red', 'blue', 'green', 'yellow'];

const roomPlayers = new Map(); // socketId -> { nickname, color, isHost }
let countdownTimer = null;
let countdownSeconds = 5;
let currentObstacles = [];

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

function getPlayersInRoom() {
  return Array.from(roomPlayers.entries()).map(([id, data]) => ({
    id,
    nickname: data.nickname,
    color: data.color,
    isHost: data.isHost
  }));
}

function getUsedColors() {
  return new Set([...roomPlayers.values()].map(p => p.color).filter(Boolean));
}

function assignRandomColor() {
  const used = getUsedColors();
  // 점프 테스트용: 모든 플레이어를 강제로 두 번째 말(논리 색상 'blue')로 고정
  // (horse2_jump / horse2_fail 이미지와 일치시키기 위함)
  return 'blue';
}

function isHost(socketId) {
  return roomPlayers.get(socketId)?.isHost === true;
}

function setNewHost() {
  const list = getPlayersInRoom();
  if (list.length === 0) return;
  const firstId = list[0].id;
  roomPlayers.forEach((data, id) => {
    data.isHost = id === firstId;
  });
}

function stopCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function startCountdown() {
  stopCountdown();
  let sec = countdownSeconds;
  io.to(ROOM_ID).emit('countdown', sec);
  countdownTimer = setInterval(() => {
    sec--;
    io.to(ROOM_ID).emit('countdown', sec);
    if (sec <= 0) {
      stopCountdown();
      currentObstacles = generateObstacles();
      io.to(ROOM_ID).emit('game_start', {
        players: getPlayersInRoom(),
        obstacles: currentObstacles
      });
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

// ========== Socket.io ==========
io.on('connection', (socket) => {
  socket.on('set_nickname', (nickname) => {
    socket.nickname = (nickname || '').trim().slice(0, 20) || 'Player';
  });

  socket.on('create_or_join', () => {
    const nickname = socket.nickname || 'Player';
    const isFirst = roomPlayers.size === 0;
    const color = assignRandomColor();
    if (!color) {
      socket.emit('error', { message: '방이 가득 찼습니다.' });
      return;
    }
    socket.join(ROOM_ID);
    roomPlayers.set(socket.id, {
      nickname,
      color,
      isHost: isFirst
    });
    socket.emit('your_info', {
      id: socket.id,
      nickname,
      color,
      isHost: isFirst,
      players: getPlayersInRoom()
    });
    socket.to(ROOM_ID).emit('player_list', getPlayersInRoom());
    if (isFirst) startCountdown();
  });

  socket.on('leave_room', () => {
    const wasHost = isHost(socket.id);
    socket.leave(ROOM_ID);
    roomPlayers.delete(socket.id);
    setNewHost();
    socket.to(ROOM_ID).emit('player_list', getPlayersInRoom());
    if (wasHost) stopCountdown();
  });

  socket.on('start_game', () => {
    if (!isHost(socket.id)) return;
    stopCountdown();
    currentObstacles = generateObstacles();
    io.to(ROOM_ID).emit('game_start', {
      players: getPlayersInRoom(),
      obstacles: currentObstacles
    });
  });

  socket.on('horse_move', (data) => {
    const me = roomPlayers.get(socket.id);
    if (!me || !me.color) return;
    io.to(ROOM_ID).emit('horse_position', {
      color: me.color,
      x: data.x,
      nickname: me.nickname
    });
  });

  socket.on('player_finished', (data) => {
    const me = roomPlayers.get(socket.id);
    if (!me) return;
    io.to(ROOM_ID).emit('race_finished', {
      winnerNickname: me.nickname,
      winnerColor: me.color,
      isWinner: true
    });
    updateWinCount(me.nickname);
  });

  socket.on('disconnect', () => {
    const wasHost = isHost(socket.id);
    socket.leave(ROOM_ID);
    roomPlayers.delete(socket.id);
    setNewHost();
    if (roomPlayers.size > 0) {
      socket.to(ROOM_ID).emit('player_list', getPlayersInRoom());
      if (wasHost) startCountdown();
    } else {
      stopCountdown();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
