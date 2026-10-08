# Night Keeper

Браузерный walking sim для Яндекс Игр (HTML5/WebGL, Three.js + Vite + TypeScript).

## Команды

```bash
npm install
npm run dev       # dev-сервер с HMR
npm run build     # прод-сборка в dist/
npm run preview   # предпросмотр собранного билда
npm run test      # Vitest (чистая логика, без Three.js)
npm run lint       # ESLint
npm run format     # Prettier
```

## Структура

- `src/core/` — ядро движка (game loop, сцены, инпут, загрузка ассетов)
- `src/systems/` — игровые системы (игрок, фонарик, взаимодействие, смены)
- `src/sdk/` — обёртка над Yandex Games SDK
- `src/data/` — общий контракт данных (`types.ts`) + конфиги зон/объектов
- `src/levels/` — раскладка объектов по зонам (`layout.json`)
- `src/ui/` — HUD и экраны (вёрстка/стили — `src/ui/styles/`)
- `src/render/` — освещение, пост-обработка, материалы
- `public/` — статика (модели, текстуры, звук), попадает в билд как есть
- `assets_src/` — исходники ассетов (Blender, high-res текстуры), в билд не попадают

`src/data/types.ts` — единственный файл, который меняется только по согласованию между бэкендом и дизайнером.
