# horse_race를 Git(GitHub)에 올리는 법

## 1단계: Git 저장소 만들기 (로컬)

프로젝트 폴더에서 터미널(또는 Cursor 터미널)을 열고:

```bash
cd C:\Game\horse_race

git init
git add .
git commit -m "경주마 게임 첫 커밋"
```

- `git init`: 이 폴더를 Git 저장소로 만듦
- `git add .`: 모든 파일 스테이징 (.gitignore 제외)
- `git commit`: 첫 커밋 생성

---

## 2단계: GitHub에서 새 저장소 만들기

1. https://github.com 접속 후 로그인
2. 오른쪽 위 **+** → **New repository**
3. **Repository name**: 예) `horse_race` (원하는 이름)
4. **Public** 선택
5. **"Add a README file"** 등은 체크하지 말고 **Create repository** 클릭
6. 생성된 페이지에서 **저장소 주소** 복사  
   - 예: `https://github.com/내아이디/horse_race.git`

---

## 3단계: 로컬을 GitHub에 연결하고 올리기

아래에서 `https://github.com/내아이디/horse_race.git` 를 **2단계에서 복사한 주소**로 바꿔서 실행:

```bash
cd C:\Game\horse_race

git remote add origin https://github.com/내아이디/horse_race.git
git branch -M main
git push -u origin main
```

- GitHub 로그인 창이 뜨면 로그인(또는 토큰 입력)
- 끝나면 GitHub 페이지에서 파일들이 보이면 성공

---

## 한 번에 복사해서 쓸 수 있는 예시

```bash
cd C:\Game\horse_race
git init
git add .
git commit -m "경주마 게임 첫 커밋"
git remote add origin https://github.com/여기에아이디/저장소이름.git
git branch -M main
git push -u origin main
```

`https://github.com/여기에아이디/저장소이름.git` 만 본인 저장소 주소로 바꾸면 됩니다.
