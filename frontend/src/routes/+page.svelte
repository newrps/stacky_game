<script lang="ts">
  import { onMount } from 'svelte';

  let rooms: { id: string; capacity: number; players: any[] }[] = [];
  let loading = true;

  onMount(async () => {
    try {
      const r = await fetch('/api/rooms');
      if (r.ok) rooms = await r.json();
    } catch {/* offline ok — solo는 어쨌든 동작 */}
    loading = false;
  });

  async function createRoom() {
    const r = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capacity: 4 })
    });
    if (r.ok) {
      const room = await r.json();
      location.href = `/room/${room.id}`;
    }
  }
</script>

<main>
  <header>
    <h1>🎮 Ps 차곡차곡</h1>
    <p class="subtitle">SRS 회전 · 7-bag · 홀드 · T-Spin · 락딜레이</p>
  </header>

  <section class="modes">
    <a class="mode solo" href="/play">
      <div class="emoji">🕹️</div>
      <h2>혼자 플레이</h2>
      <p>표준 룰셋으로 점수·라인·콤보 도전</p>
    </a>

    <button class="mode multi" on:click={createRoom}>
      <div class="emoji">⚔️</div>
      <h2>방 만들기</h2>
      <p>친구와 같은 시드로 동시 시작 (v2: 가비지 어택)</p>
    </button>
  </section>

  {#if !loading && rooms.length > 0}
    <section class="rooms">
      <h3>열린 방</h3>
      <ul>
        {#each rooms as r}
          <li>
            <a href="/room/{r.id}">
              <strong>#{r.id}</strong>
              <span>{r.players.length} / {r.capacity}</span>
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <footer>
    <p>키 조작: ← → 이동 / ↓ 소프트 / ↑ X 회전 / Z 반시계 / Space 하드드롭 / C 홀드 / Esc 일시정지</p>
  </footer>
</main>

<style>
  main {
    max-width: 720px; margin: 0 auto;
    padding: 40px 24px;
  }
  header { text-align: center; margin-bottom: 40px; }
  h1 {
    margin: 0; font-size: 48px; letter-spacing: -1px;
    background: linear-gradient(135deg, #00f0f0, #f0a000, #f00000);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .subtitle { color: #8895a3; margin-top: 8px; }

  .modes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 32px;
  }
  .mode {
    display: flex; flex-direction: column; align-items: center;
    gap: 8px; padding: 30px 20px;
    border-radius: 16px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    cursor: pointer;
    transition: transform 0.15s, background 0.15s;
    text-align: center;
    color: inherit; text-decoration: none;
    font-family: inherit; font-size: inherit;
  }
  .mode:hover { transform: translateY(-2px); background: rgba(255,255,255,0.08); }
  .mode .emoji { font-size: 48px; }
  .mode h2 { margin: 0; font-size: 20px; }
  .mode p { margin: 0; font-size: 12px; color: #8895a3; }

  .rooms {
    background: rgba(255,255,255,0.03);
    border-radius: 12px; padding: 16px 20px;
    margin-top: 20px;
  }
  .rooms h3 { margin: 0 0 10px; font-size: 14px; color: #8895a3; }
  .rooms ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
  .rooms li a {
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 12px; background: rgba(255,255,255,0.04);
    border-radius: 8px;
    color: inherit; text-decoration: none;
  }
  .rooms li a:hover { background: rgba(255,255,255,0.08); }
  .rooms strong { font-family: ui-monospace, monospace; }

  footer {
    text-align: center; margin-top: 40px;
    color: #6c7886; font-size: 11px;
  }

  @media (max-width: 480px) {
    h1 { font-size: 36px; }
    .modes { grid-template-columns: 1fr; }
  }
</style>
