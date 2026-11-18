# Video Downloader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Windows-приложение (один установщик `.exe`) для скачивания видео/аудио по ссылке, с вшитыми yt-dlp и ffmpeg и автообновлением.

**Architecture:** Electron: `main` (процесс, IPC, автообновление) + тонкий `renderer` (один экран). Вся логика (аргументы yt-dlp, разбор прогресса, ошибки, обновление и откат бинарников) лежит в `src/` чистыми модулями Node и покрыта тестами `node:test`. Бинарники yt-dlp/ffmpeg скачиваются на этапе сборки с проверкой SHA-256 и кладутся в `resources/bin`.

**Tech Stack:** Electron, electron-builder (NSIS), electron-updater, `node:test`. Без фреймворков для UI.

**Spec:** `docs/superpowers/specs/2026-11-18-video-downloader-design.md`

## Global Constraints

- Только Windows, один установщик `.exe`, NSIS `perMachine: false` (без UAC).
- Интерфейс и все сообщения об ошибках по-русски; консольный вывод и английские тексты ошибок маме не показываются.
- Папка по умолчанию: «Загрузки» пользователя. Настроек по умолчанию нет.
- Обновления приложения: GitHub Releases, аккаунт `el10n666`, репозиторий публичный (имя репозитория `yt-dlg-2` — решение ассистента, можно поправить).
- yt-dlp: только стабильные релизы с github.com/yt-dlp/yt-dlp, сверка SHA-256, обновление при каждом запуске, откат на последнюю рабочую копию при сбое.
- `autoInstallOnAppQuit: true`, обновление не посреди скачивания.
- DRM не обходится и не закладывается. Телеметрии нет.

## Review Focus

1. Ссылка с пробелами/переводом строки по краям (вставка из мессенджера) — ожидается обрезка, а не ошибка.
2. Ссылка на плейлист при обычном режиме — ожидается одно видео (`--no-playlist`), а не сотня файлов.
3. Имя пользователя Windows с кириллицей/пробелами и названия видео с запрещёнными символами — файл сохраняется (`--windows-filenames`, UTF-8).
4. Нет интернета при запуске — обновление yt-dlp молча пропускается, приложение работает с текущей копией.
5. DRM-сайт, нет места на диске, приватное/удалённое видео — понятное русское сообщение, приложение не падает.

---

### Task 1: Каркас проекта и перевод ошибок

**Files:**
- Create: `package.json`, `src/errors.js`, `test/errors.test.js`

**Interfaces:**
- Produces: `mapError(stderr: string): string` — русская фраза по тексту stderr yt-dlp; неизвестное → «Не удалось скачать. Нажмите «Сообщить о проблеме»».

- [ ] **Step 1:** `npm init`, добавить dev-зависимости `electron`, `electron-builder`; зависимость `electron-updater`; скрипт `test`: `node --test`.
- [ ] **Step 2:** Тесты `test/errors.test.js` для `mapError`: `"Video unavailable"`, `"Private video"` → «Видео недоступно или закрыто автором»; `"DRM protected"`/`"DRM"` → «Это видео защищено, скачать его нельзя»; `"Unsupported URL"` → «Этот сайт не поддерживается»; `"No space left"` → «Не хватает места на диске»; `"Unable to download webpage"` → «Нет связи с сайтом, проверьте интернет»; мусор → фраза по умолчанию.
- [ ] **Step 3:** Run `npm test` → FAIL (модуля нет).
- [ ] **Step 4:** Реализовать `mapError` таблицей regex → фраза в `src/errors.js`.
- [ ] **Step 5:** Run `npm test` → PASS. Commit.

### Task 2: Аргументы yt-dlp и разбор прогресса

**Files:**
- Create: `src/args.js`, `test/args.test.js`

**Interfaces:**
- Produces: `buildArgs({url: string, mode: 'video'|'audio', outDir: string, ffmpegDir: string}): string[]`; `parseProgress(line: string): {percent: number, speed: string, eta: string} | null`; `cleanUrl(raw: string): string | null` (null если не http/https).

- [ ] **Step 1:** Тесты: `cleanUrl("  https://youtu.be/x\n")` → `"https://youtu.be/x"`; `cleanUrl("привет")` → `null`. `buildArgs` содержит `--no-playlist`, `--windows-filenames`, `--ffmpeg-location <ffmpegDir>`, `--newline`, `--progress-template` со строкой, которую понимает `parseProgress`, `-o <outDir>/%(title).150B [%(id)s].%(ext)s`; для `audio` — `-x --audio-format mp3`, для `video` — `-f bv*+ba/b --merge-output-format mp4`. `parseProgress("PROG 42.5% 1.2MiB/s 00:31")` → `{percent:42.5, speed:"1.2MiB/s", eta:"00:31"}`; строка без `PROG` → `null`.
- [ ] **Step 2:** Run → FAIL. Реализовать в `src/args.js`. Run → PASS. Commit.

### Task 3: Менеджер бинарников (обновление и откат)

**Files:**
- Create: `src/binaries.js`, `test/binaries.test.js`

**Interfaces:**
- Consumes: ничего.
- Produces: `resolveYtDlp({bundledDir, userDir}): string` (путь рабочей копии: пользовательская, если есть, иначе вшитая); `updateYtDlp({bundledDir, userDir, run}): Promise<'updated'|'current'|'skipped'>`, где `run(exe, args)` — внедряемая функция запуска (для тестов).

- [ ] **Step 1:** Тесты с фейковым `run`: (a) `-U` успешен и `--version` отвечает → `'updated'`; (b) после обновления `--version` падает → пользовательская копия восстанавливается из `yt-dlp.bak`, результат `'skipped'`; (c) нет сети (`run` бросает) → `'skipped'`, исключение наружу не выходит.
- [ ] **Step 2:** Run → FAIL. Реализовать: копия вшитой в `userDir` при первом запуске; перед `-U` делать `yt-dlp.bak`; после — проверка `--version`; при сбое откат. Только стабильный канал (флаг `--update-to stable`).
- [ ] **Step 3:** Run → PASS. Commit.

### Task 4: Скачивание бинарников при сборке

**Files:**
- Create: `scripts/fetch-binaries.js`, `scripts/sha256.json`, `test/fetch.test.js`

**Interfaces:**
- Produces: `verifySha256(filePath: string, expected: string): Promise<boolean>`; скрипт `npm run fetch-bin` кладёт `yt-dlp.exe` и `ffmpeg.exe` в `resources/bin`.

- [ ] **Step 1:** Тест `verifySha256` на временном файле: верный хэш → `true`, неверный → `false`.
- [ ] **Step 2:** Реализовать скрипт: yt-dlp берётся из последнего стабильного релиза `yt-dlp/yt-dlp` вместе с `SHA2-256SUMS` из того же релиза; ffmpeg — Windows-сборка BtbN (`ffmpeg-master-latest-win64-gpl`; для личной раздачи, лицензия GPL зафиксирована в `README`), хэш пиним в `scripts/sha256.json` после первой ручной проверки. Несовпадение хэша → сборка падает.
- [ ] **Step 3:** Run `npm test` и `npm run fetch-bin`; убедиться, что `resources/bin/yt-dlp.exe --version` печатает версию. Commit.

### Task 5: Загрузчик и предпроверки

**Files:**
- Create: `src/downloader.js`, `test/downloader.test.js`

**Interfaces:**
- Consumes: `buildArgs`, `parseProgress`, `cleanUrl`, `mapError`, `resolveYtDlp`.
- Produces: `startDownload({url, mode, outDir, ytdlp, ffmpegDir, spawn}, onProgress): {done: Promise<{ok: boolean, message?: string, file?: string}>, cancel(): void}`; предпроверки возвращают русскую ошибку до запуска (неверная ссылка; `outDir` недоступна для записи).

- [ ] **Step 1:** Тесты с фейковым `spawn` (эмиттер stdout/stderr): строки `PROG …` приводят к вызовам `onProgress`; код выхода 0 → `ok:true`; код ≠0 со stderr `"Private video"` → `ok:false` и сообщение из `mapError`; `cancel()` убивает процесс; ссылка `"привет"` → `ok:false` без запуска процесса.
- [ ] **Step 2:** Run → FAIL. Реализовать. Для UTF-8 вывода передать `PYTHONIOENCODING=utf-8` и `--encoding utf-8`. Run → PASS. Commit.

### Task 6: Интерфейс и IPC

**Files:**
- Create: `main.js`, `preload.js`, `renderer/index.html`, `renderer/app.js`, `renderer/style.css`

**Interfaces:**
- Consumes: `startDownload`, `resolveYtDlp`, `updateYtDlp`.
- Produces: IPC `download:start {url, mode}`, `download:progress {id, percent, speed, eta}`, `download:done {id, ok, message}`, `report:save`.

- [ ] **Step 1:** Экран: поле ссылки (автоматически подставляется ссылка из буфера обмена, если она похожа на http), переключатель «Видео / Только аудио (MP3)», крупная кнопка «Скачать», список загрузок с полосой прогресса и кнопкой «Открыть папку». Кнопка «Сообщить о проблеме» пишет лог в файл на рабочем столе. Блок «Дополнительно» (cookies из браузера, прокси) свёрнут по умолчанию. Размер шрифта крупный (для пожилого пользователя).
- [ ] **Step 2:** `main.js`: при старте в фоне вызвать `updateYtDlp`, ошибки не показывать пользователю, писать в лог. `contextIsolation: true`, `nodeIntegration: false`.
- [ ] **Step 3:** Run `npx electron .`, вручную скачать короткое видео и аудио; проверить, что файл появился в «Загрузках». Commit.

### Task 7: Упаковка и автообновление

**Files:**
- Modify: `package.json` (секция `build`), `main.js`

- [ ] **Step 1:** `build`: `win.target: nsis`, `nsis.oneClick: true`, `nsis.perMachine: false`, `extraResources: resources/bin`, `publish: {provider: github, owner: el10n666, repo: yt-dlg-2}`. В `main.js` — `autoUpdater.autoInstallOnAppQuit = true`, `checkForUpdates()` при запуске, ошибки только в лог.
- [ ] **Step 2:** Скрипт `npm run release`: `fetch-bin` → `test` → `electron-builder --publish always` (требует `GH_TOKEN` в окружении владельца, в код не зашивается).
- [ ] **Step 3:** Run `npx electron-builder --win --dir`; проверить, что `resources/bin/*.exe` лежат внутри и приложение стартует. Commit.

### Task 8: Проверка на чистой Windows и живое скачивание

- [ ] **Step 1:** Выпустить `0.1.0`, поставить на чистой машине/виртуалке без Python и ffmpeg; скачать видео, аудио, плейлист-ссылку (должно скачаться одно видео), ссылку с кириллическим именем пользователя.
- [ ] **Step 2:** Выпустить `0.1.1`, убедиться, что `0.1.0` обновился сам после закрытия приложения.
- [ ] **Step 3:** Сымитировать поломку (подменить пользовательский `yt-dlp.exe` битым файлом) и проверить откат на вшитую копию.

## Self-review

- Покрытие дизайна: UI (T6), обновление приложения (T7), обновление и откат yt-dlp (T3), сверка хэшей (T4), русские ошибки (T1, T5), отчёт о проблеме (T6), DRM-сообщение (T1), без UAC (T7), проверка на чистой Windows (T8).
- Не покрыто тестами автоматически: UI и автообновление, они проверяются вручную в T6–T8.
