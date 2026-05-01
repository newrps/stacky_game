<script lang="ts">
  import GamePane from '$lib/components/GamePane.svelte';
</script>

<div class="page">
  <header>
    <a href="/" class="back">← 메뉴</a>
    <h1>혼자 플레이</h1>
  </header>
  <GamePane />
</div>

<style>
  .page { padding: 12px; }
  header {
    display: flex; align-items: center; gap: 16px;
    max-width: 720px; margin: 0 auto 8px;
  }
  h1 { margin: 0; font-size: 16px; color: #8895a3; }
  .back {
    background: rgba(255,255,255,0.05);
    padding: 6px 10px; border-radius: 8px;
    color: #e8edf3;
  }
</style>
