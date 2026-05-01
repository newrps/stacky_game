<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import GamePane from '$lib/components/GamePane.svelte';

  $: roomId = $page.params.id;
  let ws: WebSocket | null = null;
  let me = '';
  let seed = 1;
  let connected = false;
  let players: { id: string; name: string }[] = [];
  let messages: { from: string; text: string; time: number }[] = [];
  let myStatus: any = {};
  let gameRef: GamePane;
  // 라운드 상태
  let aliveSet = new Set<string>();   // 현재 라운드 생존 player id
  let koOrder: string[] = [];          // KO된 순서 (가장 일찍 KO된 순)
  let roundEnded = false;
  let winner: string | null = null;
  let myRank: number | null = null;

  onMount(() => connect());
  onDestroy(() => ws?.close());

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws/room/${roomId}`);
    ws.onopen = () => { connected = true; };
    ws.onclose = () => { connected = false; };
    ws.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.type === 'welcome') {
          me = d.you; seed = d.seed;
          players = d.room.players;
          // 입장 시점에 모두 alive
          aliveSet = new Set(players.map(p => p.id));
        } else if (d.type === 'join') {
          players = [...players, d.player];
          aliveSet.add(d.player.id); aliveSet = aliveSet;
          messages = [...messages, { from: 'system', text: `${d.player.name} 입장`, time: Date.now() }];
        } else if (d.type === 'leave') {
          players = players.filter(p => p.id !== d.player.id);
          // 살아있는 상태에서 나가면 forfeit (KO 처리)
          if (aliveSet.has(d.player.id)) {
            aliveSet.delete(d.player.id);
            koOrder = [...koOrder, d.player.id];
          }
          aliveSet = aliveSet;
          messages = [...messages, { from: 'system', text: `${d.player.name} 퇴장`, time: Date.now() }];
          checkWinner();
        } else if (d.type === 'chat') {
          messages = [...messages, { from: d.from, text: d.text, time: Date.now() }];
        } else if (d.type === 'ko') {
          // 누군가 KO
          if (aliveSet.has(d.from)) {
            aliveSet.delete(d.from);
            koOrder = [...koOrder, d.from];
            aliveSet = aliveSet;
            const name = (players.find(p => p.id === d.from)?.name) ?? '???';
            messages = [...messages, { from: 'system', text: `💀 ${name} KO`, time: Date.now() }];
            checkWinner();
          }
        } else if (d.type === 'newround') {
          // 새 라운드 시작
          seed = d.seed;
          aliveSet = new Set(players.map(p => p.id));
          koOrder = [];
          roundEnded = false;
          winner = null;
          myRank = null;
          gameRef?.restart(d.seed);
          messages = [...messages, { from: 'system', text: `🎬 새 라운드 시작 (seed: ${d.seed})`, time: Date.now() }];
        } else if (d.type === 'state') {
          // 상대 상태 업데이트 — v2에서 활용
        } else if (d.type === 'attack') {
          // 내가 타겟이면 가비지 받기
          if (d.target === me && gameRef) {
            gameRef.receiveGarbage(d.power, d.hole);
            messages = [...messages, {
              from: 'system',
              text: `🔥 ${(players.find(p => p.id === d.from)?.name) ?? '???'}로부터 ${d.power}줄 공격!`,
              time: Date.now()
            }];
          }
        }
      } catch {/* ignore */}
    };
  }

  function send(obj: any) {
    if (ws?.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function reportState(s: any) {
    myStatus = s;
    send({ type: 'state', snapshot: s });
  }

  /** GamePane 콜백 — 라인 클리어로 어택 발생 */
  function onAttack(power: number, hole: number) {
    // 살아있는 다른 플레이어 중 무작위 1명 선택
    const others = players.filter(p => p.id !== me && aliveSet.has(p.id));
    if (others.length === 0) return;
    const target = others[Math.floor(Math.random() * others.length)];
    send({ type: 'attack', target: target.id, power, hole });
  }

  /** GamePane 콜백 — 내 게임이 끝남 */
  function onGameOver() {
    send({ type: 'ko' });
    if (aliveSet.has(me)) {
      aliveSet.delete(me);
      koOrder = [...koOrder, me];
      aliveSet = aliveSet;
      checkWinner();
    }
  }

  function checkWinner() {
    if (roundEnded) return;
    const ac = aliveSet.size;
    // 종료: KO가 한 번이라도 발생 + 생존자 1명 이하 (대결 모드)
    //       또는 본인 혼자 룸에서 죽음 (솔로 모드)
    const hadKo = koOrder.length > 0;
    const battleEnded = hadKo && ac <= 1 && (koOrder.length + ac >= 2);
    const soloEnded = players.length <= 1 && ac === 0;
    if (battleEnded || soloEnded) {
      winner = ac === 1 ? [...aliveSet][0] : null;
      if (me === winner) {
        myRank = 1;
      } else {
        const koPos = koOrder.indexOf(me);
        myRank = koPos >= 0 ? Math.max(2, koOrder.length - koPos + (winner ? 1 : 0)) : null;
      }
      roundEnded = true;
    }
  }

  function startNewRound() {
    const newSeed = Math.floor(Math.random() * 0x7fffffff);
    send({ type: 'newround', seed: newSeed });
    // 자기 자신에게도 적용 (자기가 보낸 메시지 echo도 받지만, 안전하게 즉시 처리)
  }

  $: aliveCount = aliveSet.size;

  let chatInput = '';
  function sendChat() {
    if (!chatInput.trim()) return;
    send({ type: 'chat', text: chatInput });
    chatInput = '';
  }
</script>

<div class="page">
  <header>
    <a href="/" class="back">← 메뉴</a>
    <div class="room-info">
      <h1>방 #{roomId}</h1>
      <span class="seed">seed: {seed}</span>
      <span class="conn" class:on={connected}>{connected ? '🟢 연결됨' : '🔴 연결 끊김'}</span>
    </div>
  </header>

  <div class="layout">
    <main>
      {#if connected}
        <GamePane bind:this={gameRef} {seed}
          onStateChange={reportState}
          {onAttack}
          {onGameOver}
          inputLocked={roundEnded} />
      {:else}
        <p class="loading">연결 중…</p>
      {/if}

      {#if roundEnded}
        <div class="round-result" class:victory={winner === me}>
          <div class="modal-card">
            {#if winner === me}
              <div class="medal">🏆</div>
              <h2 class="win">VICTORY</h2>
              <p class="big">상대 전원 KO!</p>
            {:else if myRank === 1}
              <div class="medal">🏆</div>
              <h2 class="win">VICTORY</h2>
            {:else if myRank}
              <div class="medal">{myRank === 2 ? '🥈' : myRank === 3 ? '🥉' : '🎖️'}</div>
              <h2>{myRank}등</h2>
              {#if winner}
                <p>승자: <b>{(players.find(p => p.id === winner)?.name) ?? winner}</b></p>
              {/if}
            {:else}
              <h2>게임 오버</h2>
            {/if}
            <button class="restart" on:click={startNewRound}>🎬 다시 시작</button>
          </div>
        </div>
      {/if}
    </main>

    <aside class="side">
      <section>
        <h3>참가자 ({players.length}) · 생존 {aliveCount}</h3>
        <ul class="players">
          {#each players as p}
            {@const alive = aliveSet.has(p.id)}
            <li class:dead={!alive}>
              <span class="dot" style="background: {alive ? (p.id === me ? '#00f0f0' : '#4caf50') : '#555'}"></span>
              {p.name}{p.id === me ? ' (나)' : ''}
              {#if !alive}<span class="ko-tag">💀 KO</span>{/if}
            </li>
          {/each}
        </ul>
      </section>
      <section class="chat">
        <h3>채팅</h3>
        <ul>
          {#each messages.slice(-30) as m}
            <li class:system={m.from === 'system'}>
              {#if m.from === 'system'}
                <em>{m.text}</em>
              {:else}
                <b>{(players.find(p => p.id === m.from)?.name) ?? m.from}</b>: {m.text}
              {/if}
            </li>
          {/each}
        </ul>
        <form on:submit|preventDefault={sendChat}>
          <input bind:value={chatInput} placeholder="메시지" />
          <button type="submit">↵</button>
        </form>
      </section>
    </aside>
  </div>
</div>

<style>
  .page { padding: 12px; min-height: 100vh; }
  header {
    display: flex; align-items: center; gap: 16px;
    max-width: 1100px; margin: 0 auto 12px;
  }
  .room-info {
    display: flex; align-items: center; gap: 12px;
    flex: 1;
  }
  h1 { margin: 0; font-size: 16px; }
  .seed { font-family: ui-monospace, monospace; color: #8895a3; font-size: 11px; }
  .conn { color: #6c7886; font-size: 11px; }
  .conn.on { color: #2e7d32; }
  .back {
    background: rgba(255,255,255,0.05);
    padding: 6px 10px; border-radius: 8px;
    color: #e8edf3;
  }

  .layout {
    display: grid;
    grid-template-columns: 1fr 280px;
    gap: 16px;
    max-width: 1100px; margin: 0 auto;
  }
  main { min-height: 600px; }
  .loading { text-align: center; color: #8895a3; padding: 40px; }

  .side {
    display: flex; flex-direction: column; gap: 12px;
  }
  section {
    background: rgba(255,255,255,0.04);
    border-radius: 10px; padding: 12px;
  }
  section h3 {
    margin: 0 0 8px; font-size: 11px;
    color: #8895a3; letter-spacing: 1px;
  }
  .players { list-style: none; padding: 0; margin: 0; }
  .players li {
    display: flex; align-items: center; gap: 8px;
    padding: 4px 0; font-size: 13px;
  }
  .players .dot { width: 8px; height: 8px; border-radius: 50%; }
  .players li.dead { opacity: 0.45; }
  .ko-tag { font-size: 10px; color: #f44336; margin-left: auto; }

  .round-result {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.7);
    display: flex; align-items: center; justify-content: center;
    z-index: 9999;
  }
  .modal-card {
    background: #1a1f26;
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 16px;
    padding: 32px 48px;
    text-align: center;
    box-shadow: 0 12px 64px rgba(0,0,0,0.6);
    min-width: 280px;
  }
  .medal { font-size: 64px; line-height: 1; }
  .modal-card h2 {
    margin: 8px 0 16px; font-size: 28px;
  }
  .modal-card h2.win {
    font-size: 42px;
    letter-spacing: 4px;
    background: linear-gradient(135deg, #FFD700, #FF8C00);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation: glow 1.5s ease-in-out infinite alternate;
  }
  @keyframes glow {
    from { filter: drop-shadow(0 0 8px rgba(255, 215, 0, 0.4)); }
    to { filter: drop-shadow(0 0 24px rgba(255, 140, 0, 0.7)); }
  }
  .big { font-size: 16px; color: #FFD700 !important; font-weight: 600; }
  .round-result.victory {
    background: radial-gradient(circle at center, rgba(255, 140, 0, 0.25), rgba(0,0,0,0.85));
  }
  .modal-card p { color: #8895a3; font-size: 14px; margin: 0 0 20px; }
  .restart {
    background: linear-gradient(135deg, #00f0f0, #0277BD);
    border: none; color: #fff;
    padding: 10px 24px; border-radius: 10px;
    font-size: 14px; font-weight: 700;
    cursor: pointer; font-family: inherit;
    box-shadow: 0 4px 16px rgba(2, 119, 189, 0.3);
  }
  .restart:hover { filter: brightness(1.1); }

  .chat { flex: 1; display: flex; flex-direction: column; }
  .chat ul {
    list-style: none; padding: 0; margin: 0 0 8px;
    flex: 1; max-height: 320px; overflow-y: auto;
    font-size: 12px;
  }
  .chat li { padding: 2px 0; }
  .chat li.system { color: #6c7886; font-style: italic; }
  .chat form { display: flex; gap: 4px; }
  .chat input {
    flex: 1; background: rgba(0,0,0,0.3);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px; padding: 6px 8px;
    color: inherit; font-family: inherit; font-size: 12px;
  }
  .chat button {
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 6px; padding: 6px 12px;
    color: inherit; cursor: pointer;
  }

  @media (max-width: 900px) {
    .layout { grid-template-columns: 1fr; }
  }
</style>
