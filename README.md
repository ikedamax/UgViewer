# UgViewer

React + Vite プロジェクトで UG (User Guide) ワークフローを可視化するビューアです。React Flow を使ってノード・エッジを表示し、右ペインで詳細を確認できます。

## 必要要件

- Node.js 18 以上
- npm 9 以上

## セットアップ

```bash
npm install
```

## 開発サーバーの起動

```bash
npm run dev
```

ブラウザで `http://localhost:5173` を開くと、サンプルの UG データを表示したビューアが動作します。

## ビルド

```bash
npm run build
```

## プロジェクト構成

- `src/components/UgViewer.tsx` — UG JSON を受け取り React Flow で描画するメインコンポーネント
- `src/lib/sampleUg.ts` — 開発用のサンプルデータ
- `src/components/ui/` — shadcn/ui 風の簡易 UI コンポーネント

必要に応じて `UgViewer` コンポーネントに任意の UG データを渡して利用してください。
