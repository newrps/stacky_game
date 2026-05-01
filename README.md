# 🎮 Ps 차곡차곡

웹 기반 차곡차곡 — 솔로 플레이 + 실시간 멀티플레이.

## 구성

```
backend/   Rust (axum + WebSocket) — 룸/매치 관리
frontend/  SvelteKit + HTML5 Canvas — 게임 렌더링
```

## 기능 (v1)

- ✅ 7 테트로미노 (I, O, T, S, Z, J, L) + SRS 회전
- ✅ 7-bag 랜덤, 다음 5개 미리보기, Hold
- ✅ 소프트드롭 / 하드드롭 / 락 딜레이
- ✅ 라인 클리어, T-Spin 인식, 콤보, B2B
- ✅ 점수·레벨·라인 카운터
- ⏳ 멀티플레이 룸 (스켈레톤만, v2에서 가비지 어택)

## 키 조작

| 키 | 동작 |
|----|------|
| ← → | 좌우 이동 |
| ↓ | 소프트 드롭 |
| ↑ / X | 시계방향 회전 |
| Z | 반시계 회전 |
| Space | 하드 드롭 |
| C / Shift | Hold |
| Esc | 일시정지 |

## 실행

```bash
# 백엔드 (멀티플레이 룸 서버)
cd backend && cargo run    # → :8772

# 프론트
cd frontend && npm install && npm run dev  # → :5177
```

## 환경변수

| 키 | 설명 |
|----|------|
| `PORT` | 백엔드 포트 (기본 8772) |
| `HOST_PORT` | 프론트 호스트 포트 (기본 18083) |
