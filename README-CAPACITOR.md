# 경주마 스타트 Pro - Capacitor 앱 빌드

## 준비

1. **말 이미지**  
   `horse1.png` ~ `horse4.png`를 프로젝트 루트에 두었다면 `www` 폴더로 복사하세요.
   ```bash
   copy horse*.png www\
   ```
   (PowerShell: `Copy-Item horse*.png www\`)

2. **소켓 서버 URL (앱에서 멀티플레이)**  
   앱은 서버가 없으므로, Render 등에 배포한 서버 주소가 필요합니다.  
   `www/index.html` 상단에서 다음처럼 설정할 수 있습니다.
   ```html
   <script>
   window.SOCKET_URL = 'https://your-app.onrender.com';  // 배포한 서버 주소
   </script>
   <script src="...기존 스크립트...">
   ```
   또는 빌드 전에 `www/index.html` 안의 `const SOCKET_URL = ...` 를 서버 URL로 바꿔도 됩니다.

## 빌드 및 실행

```bash
# 1. 웹 소스 동기화 (index.html, style.css, www 내용을 Android에 반영)
npx cap sync

# 2. Android Studio에서 열기
npx cap open android
```

Android Studio가 열리면:

- **Run** (▶) 버튼으로 에뮬레이터 또는 연결된 폰에서 실행
- **Build → Build Bundle(s) / APK(s) → Build APK(s)** 로 APK 생성 후 폰에 설치

## 웹 수정 후

`index.html` 또는 `style.css`를 수정한 뒤에는 **반드시** `www`에 반영한 다음 sync 하세요.

- 루트의 `index.html` / `style.css`를 수정했다면:
  ```bash
  copy index.html www\
  copy style.css www\
  npx cap sync
  ```
- 또는 `www/index.html`, `www/style.css`를 직접 수정한 뒤:
  ```bash
  npx cap sync
  ```

말 이미지를 바꿨다면 `www`에 다시 복사한 뒤 `npx cap sync` 하세요.

## iOS (Mac 필요)

Mac에서만 가능합니다.

```bash
npm install @capacitor/ios --save-dev
npx cap add ios
npx cap open ios
```
