# 경주마 스타트 Pro - 로컬 테스트 → 배포

## 1. 로컬에서 먼저 테스트

모든 서버·프론트를 로컬에서 띄워 테스트한 뒤, 문제없을 때 Render·Netlify에 올리면 됩니다.

1. **의존성 설치**
   ```bash
   cd C:\Game\horse_race
   npm install
   ```

2. **서버 실행** (프론트 + 소켓 한 번에)
   ```bash
   npm start
   ```
   기본 포트 **3000** 사용 (환경 변수 `PORT` 없을 때).

3. **브라우저에서 확인**
   - `http://localhost:3000` 접속
   - 별명 입력 후 "게임 시작" → 대기방(카운트다운·플레이어 목록) → "시작하기" 또는 10초 후 경주

4. **멀티플레이 테스트**
   - 같은 주소를 **여러 탭** 또는 **다른 기기(같은 Wi‑Fi)**에서 열어서 접속
   - 소켓 URL은 수정하지 않아도 됨. (`SOCKET_URL` 비어 있으면 현재 도메인으로 연결)

5. **Supabase (선택)**
   - 로컬에서는 `SUPABASE_URL`·키를 안 넣어도 게임은 동작함. 우승 시 승수만 DB에 안 올라감.
   - 테스트하려면 `.env`에 넣거나 터미널에서 `set SUPABASE_URL=...` (Windows) 후 `npm start`.

로컬 테스트가 끝나면 아래처럼 배포하면 됩니다.

---

## 2. 배포 구성 (테스트 완료 후)
- **프론트**: Netlify (정적 호스팅)
- **백엔드**: Render (Node.js, server.js)
- **DB**: Supabase (승수 저장, 선택)

## Netlify
1. 프로젝트 연결 후 빌드 설정: 빌드 명령 없음, 배포 경로 `./`
2. `index.html`, `style.css`, `horse1.png`~`horse4.png` 등이 루트에 있도록 배포
3. 환경 변수(선택): `VITE_SOCKET_URL` 등으로 소켓 서버 URL 지정 시, index.html에서 `window.SOCKET_URL` 설정

## Render (백엔드)
1. New → Web Service, 저장소 연결
2. Root Directory: `horse_race` (또는 프로젝트 폴더)
3. Build: `npm install`
4. Start: `npm start`
5. 환경 변수:
   - `PORT`: 자동 할당 (비워둠)
   - `SUPABASE_URL`: Supabase 프로젝트 URL
   - `SUPABASE_SERVICE_KEY` 또는 `SUPABASE_ANON_KEY`: Supabase 키

## Supabase
1. 대시보드 → SQL Editor에서 `supabase-schema.sql` 내용 실행
2. Render에 `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` 설정

## 프론트에서 소켓 URL 지정 (Netlify)
Render URL이 `https://horse-race-xxx.onrender.com` 이라면:
- Netlify에서 빌드 시 환경 변수로 넘기거나,
- index.html 수정: `const SOCKET_URL = 'https://horse-race-xxx.onrender.com';`

## Capacitor로 앱 빌드
1. 프로젝트 루트에서: `npm init -y` (없다면)
2. `npm install @capacitor/core @capacitor/cli`
3. `npx cap init "경주마스타트" "com.horserace.app"`
4. 웹 빌드 결과물을 `www` 또는 지정한 폴더에 두고: `npx cap add android` / `npx cap add ios`
5. `npx cap sync` 후 Android Studio / Xcode에서 열어 빌드

앱에서는 Netlify URL을 웹뷰로 띄우거나, 빌드된 정적 파일 + Render 소켓 URL을 사용하면 됩니다.
