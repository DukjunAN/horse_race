# Render 서버 + Supabase DB 올리는 법

## 흐름 요약

- **Render**: Node.js 서버(server.js) 배포 → 게임 소켓·로비 담당
- **Supabase**: DB(PostgreSQL) 호스팅 → 우승 시 별명별 승수 저장
- 서버는 Render에서 돌리고, DB는 Supabase에서 쓰므로 **Render에 DB를 올리는 게 아니라** Supabase를 만들어 두고 **Render 서버에서 Supabase 주소만 연결**하면 됩니다.

---

## 1단계: Supabase(DB) 만들기

1. **가입·프로젝트 생성**
   - https://supabase.com 접속 후 로그인(또는 가입)
   - **New project** → Organization 선택(없으면 생성) → 프로젝트 이름(예: `horse-race`), 비밀번호 설정, 리전 선택 후 **Create new project**

2. **테이블·함수 생성**
   - 왼쪽 메뉴 **SQL Editor** 클릭
   - **New query** 선택 후, 아래 SQL 전체 복사해 붙여넣고 **Run** 실행

   ```sql
   -- 승수 저장용 테이블
   create table if not exists player_stats (
     nickname text primary key,
     wins int not null default 0,
     updated_at timestamptz default now()
   );

   -- 서버에서 호출할 함수 (우승 시 승수 +1)
   create or replace function increment_wins(p_nickname text)
   returns void
   language plpgsql
   security definer
   as $$
   begin
     insert into player_stats (nickname, wins)
     values (p_nickname, 1)
     on conflict (nickname)
     do update set wins = player_stats.wins + 1, updated_at = now();
   end;
   $$;
   ```

3. **연결 정보 복사**
   - 왼쪽 **Project Settings**(톱니바퀴) → **API**
   - 아래 두 개 복사해 메모장에 붙여넣어 둠:
     - **Project URL** (예: `https://xxxxxxxx.supabase.co`)
     - **service_role** 키 (Secret 키 표시 후 복사)  
       → 서버 전용이므로 **절대 프론트/브라우저에 노출하지 말 것**

---

## 2단계: Render에 서버 올리기

1. **코드가 GitHub/GitLab에 있어야 함**
   - 로컬 프로젝트(`horse_race` 폴더)를 Git 저장소로 만들고, GitHub 등에 푸시해 두세요.
   - Render는 이 저장소를 연결해서 배포합니다.

2. **Render 로그인**
   - https://render.com 접속 후 로그인(또는 GitHub로 가입)

3. **Web Service 생성**
   - 대시보드에서 **New +** → **Web Service**
   - **Connect a repository**에서 사용할 저장소 선택(또는 GitHub 연동 후 선택)
   - 저장소가 나오면 **Connect** 클릭

4. **설정 입력**
   - **Name**: 예) `horse-race-server`
   - **Region**: 가까운 리전 선택
   - **Root Directory**:  
     - 저장소 루트가 `horse_race` 프로젝트면 **비워두기**  
     - 저장소가 상위 폴더고 그 안에 `horse_race`가 있으면 `horse_race` 입력
   - **Runtime**: **Node**
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free 선택 가능(스펙 낮음, 슬립 있음)

5. **환경 변수(Environment) 추가**
   - **Environment** 섹션에서 **Add Environment Variable** 클릭
   - 아래 세 개 추가 (Supabase에서 복사한 값 사용):

   | Key | Value |
   |-----|--------|
   | `SUPABASE_URL` | Supabase **Project URL** (예: `https://xxxx.supabase.co`) |
   | `SUPABASE_SERVICE_KEY` | Supabase **service_role** 키 |

   - `PORT`는 **비우기** (Render가 자동으로 넣어 줌)

6. **Create Web Service** 클릭
   - 빌드·배포가 자동으로 진행됨
   - 끝나면 **서버 URL**이 나옴 (예: `https://horse-race-server.onrender.com`)

---

## 3단계: 동작 확인

1. **서버만 테스트**
   - 브라우저에서 `https://[내-Render-URL]` 접속  
   - 현재 프로젝트는 루트에 `index.html`이 있으면 그 페이지가 뜨고, 없으면 빈 페이지나 404가 나올 수 있음.  
   - **실제 게임은 Netlify 등에서 프론트를 배포한 뒤**, 그쪽에서 소켓 연결을 Render URL로 하면 됨.

2. **Netlify 프론트에서 연결**
   - Netlify에 배포한 웹 게임의 `index.html`에서 **소켓 서버 주소**를 Render URL로 설정:
     - `const SOCKET_URL = 'https://horse-race-server.onrender.com';`  
     (실제 생성된 Render URL로 바꾸기)
   - 이렇게 하면 브라우저에서 Netlify 주소로 접속 → 게임이 Render 서버와 소켓 연결 → 멀티플레이·로비 동작

3. **DB(승수) 확인**
   - 게임에서 한 번 우승한 뒤
   - Supabase 대시보드 → **Table Editor** → `player_stats` 테이블 열기  
   - 해당 별명으로 `wins`가 1 증가했는지 확인

---

## 정리

| 구분 | 하는 일 |
|------|----------|
| **Supabase** | 프로젝트 생성 → SQL로 테이블·함수 생성 → Project URL + service_role 키 복사 |
| **Render** | 저장소 연결 → Web Service 생성 → Build: `npm install`, Start: `npm start` → 환경변수에 `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` 설정 |
| **연결** | Render 서버가 Supabase URL·키로 DB 접속해 우승 시 `increment_wins()` 호출 |

DB는 Supabase에만 있고, Render에는 **서버 코드만** 올리면 됩니다. 서버가 환경 변수로 Supabase 주소를 알고 있어서 그쪽 DB를 쓰는 구조입니다.
