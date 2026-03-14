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

const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000
});

// ========== 방·플레이어 상태 ==========
const ROOM_ID = 'lobby';
const COLORS = ['red', 'blue', 'green', 'yellow'];

const roomPlayers = new Map(); // socketId -> { nickname, color, isHost }
let countdownTimer = null;
let countdownSeconds = 10;

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
  const available = COLORS.filter(c => !used.has(c));
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
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
      io.to(ROOM_ID).emit('game_start', { players: getPlayersInRoom() });
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
    io.to(ROOM_ID).emit('game_start', { players: getPlayersInRoom() });
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
