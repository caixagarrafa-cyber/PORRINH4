(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    supabase: null, playerId: localStorage.getItem('porrinh4PlayerId') || makeId(),
    roomCode: null, channel: null, room: null, selectedNumber: null, selectedBet: null,
    timer: null, displayTimer: null, demo: false, hostToken: null, playerToken: null, playerName: '', revealing: false
  };
  localStorage.setItem('porrinh4PlayerId', state.playerId);
  const dialog = $('settings-dialog');
  const toast = (message) => { const box = $('toast'); box.textContent = message; box.classList.add('show'); setTimeout(() => box.classList.remove('show'), 2800); };
  const setConnection = (message) => { $('connection-state').textContent = message; };
  const cleanName = (name) => (name || '').trim().slice(0, 18);
  const players = () => Object.entries(state.room?.players || {}).map(([uid, player]) => ({ uid, ...player }));
  const isHost = () => state.room?.hostUid === state.playerId;

  function makeId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  }
  function makeSecret() {
    const bytes = new Uint8Array(24);
    if (crypto.getRandomValues) crypto.getRandomValues(bytes); else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.random() * 256;
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  function makeCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  }
  function showSettings(message = 'Preencha os dois dados do seu projeto Supabase.') {
    $('supabase-url').value = localStorage.getItem('porrinh4SupabaseUrl') || '';
    $('supabase-key').value = localStorage.getItem('porrinh4SupabaseKey') || '';
    setConnection(message);
    dialog.showModal();
  }
  $('settings-open').addEventListener('click', () => showSettings());

  async function connectSupabase(url, key) {
    if (!window.supabase?.createClient) throw new Error('A biblioteca não carregou. Verifique a internet e tente novamente.');
    const normalizedUrl = url.trim().replace(/\/$/, '');
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(normalizedUrl)) throw new Error('A URL deve ter este formato: https://seuprojeto.supabase.co');
    if (!key.trim()) throw new Error('Cole a chave publicável do Supabase.');
    const client = window.supabase.createClient(normalizedUrl, key.trim());
    const { error } = await client.from('porrinh4_rooms').select('code').limit(1);
    if (error) {
      if (error.code === '42P01' || error.message?.includes('porrinh4_rooms')) throw new Error('Ainda falta executar o arquivo SQL Setup no SQL Editor do Supabase.');
      throw new Error(error.message || 'Não foi possível acessar o banco. Confira URL e chave.');
    }
    state.supabase = client;
    localStorage.setItem('porrinh4SupabaseUrl', normalizedUrl);
    localStorage.setItem('porrinh4SupabaseKey', key.trim());
    setConnection('Conectado ao Supabase. Pode criar ou entrar numa sala.');
    return true;
  }

  $('supabase-save').addEventListener('click', async (event) => {
    event.preventDefault();
    const button = $('supabase-save'); button.disabled = true; button.textContent = 'Conectando…';
    try {
      await connectSupabase($('supabase-url').value, $('supabase-key').value);
      dialog.close(); toast('Conexão pronta. Agora crie uma sala online.');
    } catch (error) { setConnection(error.message); }
    finally { button.disabled = false; button.textContent = 'Salvar e conectar'; }
  });

  const savedUrl = localStorage.getItem('porrinh4SupabaseUrl');
  const savedKey = localStorage.getItem('porrinh4SupabaseKey');
  if (savedUrl && savedKey) connectSupabase(savedUrl, savedKey).catch((error) => setConnection(error.message));

  async function action(actionName, payload = {}, code = state.roomCode, playerId = state.playerId) {
    const { data, error } = await state.supabase.rpc('porrinh4_action', {
      p_code: code, p_action: actionName, p_player_id: playerId, p_payload: payload
    });
    if (error) throw error;
    return data;
  }
  function requireSupabase() {
    if (state.supabase) return true;
    showSettings('Para jogar online, crie o projeto Supabase e execute o SQL Setup. Para experimentar agora, use “Jogar agora”.');
    return false;
  }

  async function createRoom() {
    if (!requireSupabase()) return;
    state.playerName = cleanName($('player-name').value) || 'Operador'; $('player-name').value = state.playerName;
    let lastError;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeCode(); const token = makeSecret();
      try {
        const room = await action('create', { name: state.playerName, hostToken: token, playerToken: token }, code);
        state.hostToken = token; state.playerToken = token;
        localStorage.setItem(`porrinh4Host:${code}`, token); localStorage.setItem(`porrinh4Player:${code}`, token);
        enterRoom(code, room); return;
      } catch (error) { lastError = error; if (!String(error.message).toLowerCase().includes('duplicate')) break; }
    }
    toast(lastError?.message || 'Não consegui criar a sala. Confira a conexão do Supabase.');
  }

  async function joinRoom() {
    if (!requireSupabase()) return;
    state.playerName = cleanName($('player-name').value) || 'Jogador'; $('player-name').value = state.playerName;
    const code = $('room-code-input').value.trim().toUpperCase();
    if (code.length !== 6) { toast('Digite o código de 6 caracteres que o anfitrião compartilhou.'); return; }
    try {
      const playerToken = localStorage.getItem(`porrinh4Player:${code}`) || makeSecret();
      const room = await action('join', { name: state.playerName, playerToken }, code);
      state.playerToken = playerToken; localStorage.setItem(`porrinh4Player:${code}`, playerToken);
      if (room.hostUid === state.playerId) state.hostToken = localStorage.getItem(`porrinh4Host:${code}`);
      enterRoom(code, room);
    } catch (error) { toast(readableError(error)); }
  }
  function readableError(error) {
    const message = error?.message || 'Erro inesperado.';
    if (message.includes('Sala não encontrada')) return 'Não encontrei essa sala. Confira o código e tente de novo.';
    if (message.includes('Sala cheia')) return 'Essa sala já tem 10 jogadores.';
    if (message.includes('rodada já começou')) return 'A rodada já começou. Entre na próxima.';
    if (message.includes('já foi reservado')) return 'Esse palpite já foi escolhido. Selecione outro.';
    return message;
  }

  function enterRoom(code, room) {
    leaveRoom(false); state.roomCode = code; state.room = room; state.demo = false;
    $('home-view').classList.add('hidden'); $('room-view').classList.remove('hidden'); renderRoom();
    $('notice').classList.add('hidden');
    state.channel = state.supabase.channel(`porrinh4-${code}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'porrinh4_rooms', filter: `code=eq.${code}` }, (event) => {
        if (event.new?.state) {
          if (state.room?.phase !== 'playing' && event.new.state.phase === 'playing') { state.selectedNumber = null; state.selectedBet = null; }
          state.room = event.new.state; maybeAdvance(); renderRoom();
        }
      })
      .subscribe((status) => { if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') toast('A conexão em tempo real caiu. Confira a internet.'); });
    maybeAdvance();
  }

  function startPractice() {
    state.demo = true; state.hostToken = null; state.roomCode = 'TREINO';
    state.playerName = cleanName($('player-name').value) || 'Você'; $('player-name').value = state.playerName;
    const botNames = ['Bia', 'Rafa', 'Dudu'];
    const bets = Array.from({ length: 13 }, (_, i) => i).sort(() => Math.random() - .5).slice(0, 3);
    const demoPlayers = {
      [state.playerId]: { name: state.playerName, ready: false, host: true, joinedAt: 0 }
    };
    botNames.forEach((name, index) => { const id = `bot-${index + 1}`; demoPlayers[id] = { name, ready: true, host: false, joinedAt: index + 1, number: Math.floor(Math.random() * 4), bet: bets[index] }; });
    state.room = { hostUid: state.playerId, phase: 'playing', round: 1, players: demoPlayers };
    $('home-view').classList.add('hidden'); $('room-view').classList.remove('hidden'); renderRoom();
    $('notice').textContent = 'Modo treino: você está jogando com 3 participantes fictícios. Para jogar com amigos, configure a sala online.';
    $('notice').classList.remove('hidden');
  }

  async function hostAction(actionName) {
    if (state.demo) {
      if (actionName === 'start') { state.room.phase = 'playing'; renderRoom(); }
      if (actionName === 'next') {
        state.room.round += 1; state.room.phase = 'playing'; state.room.sum = null;
        const bets = Array.from({ length: Object.keys(state.room.players).length * 3 + 1 }, (_, i) => i).sort(() => Math.random() - .5).slice(0, 3);
        Object.entries(state.room.players).forEach(([id, player], index) => {
          if (id === state.playerId) { player.ready = false; delete player.number; delete player.bet; }
          else { player.ready = true; player.number = Math.floor(Math.random() * 4); player.bet = bets[index - 1]; }
        });
        renderRoom();
      }
      return;
    }
    try {
      state.room = await action(actionName, { playerToken: state.playerToken, hostToken: state.hostToken });
      if (actionName === 'start' || actionName === 'next') { state.selectedNumber = null; state.selectedBet = null; }
      renderRoom();
    } catch (error) { toast(readableError(error)); }
  }

  function maybeAdvance() {
    clearInterval(state.timer); state.timer = null;
    if (state.room?.phase !== 'countdown') return;
    const endsAt = Number(state.room.countdownEndsAt || Date.now());
    const reveal = async () => {
      if (Date.now() < endsAt || state.room?.phase !== 'countdown' || state.revealing) return;
      if (state.demo) {
        clearInterval(state.timer); state.timer = null;
        const list = players(); state.room.sum = list.reduce((sum, player) => sum + Number(player.number || 0), 0);
        state.room.phase = 'result'; state.room.players = Object.fromEntries(list.map(player => [player.uid, player])); renderRoom();
      } else {
        state.revealing = true;
        try { state.room = await action('reveal', { playerToken: state.playerToken }); clearInterval(state.timer); state.timer = null; renderRoom(); }
        catch (error) { if (!error.message?.includes('Aguarde o fim')) { clearInterval(state.timer); state.timer = null; toast(readableError(error)); } }
        finally { state.revealing = false; }
      }
    };
    state.timer = setInterval(reveal, 120);
  }

  function renderRoom() {
    const room = state.room; if (!room) return;
    $('room-code').textContent = state.roomCode; $('room-title').textContent = state.demo ? 'Modo treino' : `Sala ${state.roomCode}`; $('round-number').textContent = room.round || 1;
    const list = players(); $('player-count').textContent = `${list.length}/10`;
    const labels = { lobby: ['Aguardando jogadores', 'SALA ABERTA'], playing: ['Faça sua escolha', 'ESCOLHAS ABERTAS'], countdown: ['Revelando em breve', 'CONTAGEM'], result: ['Resultado da rodada', 'RESULTADO'] };
    $('phase-title').textContent = labels[room.phase]?.[0] || 'Sala'; $('phase-pill').textContent = labels[room.phase]?.[1] || 'SALA';
    $('host-controls').classList.toggle('hidden', !(room.phase === 'lobby' && isHost()));
    $('pick-panel').classList.toggle('hidden', room.phase !== 'playing' || !!room.players?.[state.playerId]?.ready);
    $('waiting-panel').classList.toggle('hidden', room.phase !== 'countdown' && !(room.phase === 'playing' && !!room.players?.[state.playerId]?.ready));
    $('result-panel').classList.toggle('hidden', room.phase !== 'result');
    if (room.phase === 'playing' && room.players?.[state.playerId]?.ready) { $('waiting-title').textContent = 'Escolha confirmada'; $('waiting-copy').textContent = 'Suas escolhas estão guardadas em segredo.'; $('countdown').classList.add('hidden'); }
    clearInterval(state.displayTimer);
    if (room.phase === 'countdown') {
      $('waiting-title').textContent = 'Todo mundo confirmou!'; $('waiting-copy').textContent = 'A soma será revelada em instantes.'; $('countdown').classList.remove('hidden');
      const tick = () => { $('countdown').textContent = Math.max(0, Math.ceil(((room.countdownEndsAt || Date.now()) - Date.now()) / 1000)); };
      tick(); state.displayTimer = setInterval(tick, 100);
    }
    renderPlayerList(list);
    if (room.phase === 'playing' && !room.players?.[state.playerId]?.ready) renderChoices(list);
    if (room.phase === 'result') renderResult(list);
  }
  function renderPlayerList(list) {
    $('players-list').innerHTML = list.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0)).map((player) => {
      const status = player.ready ? (state.room.phase === 'result' ? 'Escolha revelada' : 'Confirmado') : state.room.phase === 'lobby' ? 'Na sala' : 'Escolhendo número e aposta';
      return `<div class="player-row"><div class="avatar">${escapeHtml((player.name || '?')[0].toUpperCase())}</div><div class="player-meta"><div class="player-name">${escapeHtml(player.name || 'Jogador')} ${player.uid === state.playerId ? '<span class="host-tag">(você)</span>' : ''} ${player.host ? '<span class="host-tag">HOST</span>' : ''}</div><div class="player-status ${player.ready ? 'status-ready' : ''}">${status}</div></div><span class="host-tag">${player.ready ? '✓' : '●'}</span></div>`;
    }).join('');
  }
  function renderChoices(list) {
    $('number-options').innerHTML = [0, 1, 2, 3].map((number) => `<button class="number-option ${state.selectedNumber === number ? 'selected' : ''}" data-number="${number}">${number}</button>`).join('');
    $('number-options').querySelectorAll('button').forEach((button) => button.addEventListener('click', () => { state.selectedNumber = Number(button.dataset.number); renderRoom(); }));
    const taken = new Set(list.filter((player) => player.uid !== state.playerId && player.ready).map((player) => player.bet));
    const max = list.length * 3;
    $('bet-options').innerHTML = Array.from({ length: max + 1 }, (_, number) => `<button class="bet-option ${state.selectedBet === number ? 'selected' : ''}" data-bet="${number}" ${taken.has(number) ? 'disabled title="Palpite reservado"' : ''}>${number}</button>`).join('');
    $('bet-options').querySelectorAll('button:not(:disabled)').forEach((button) => button.addEventListener('click', () => { state.selectedBet = Number(button.dataset.bet); renderRoom(); }));
    $('confirm-choice').disabled = !Number.isInteger(state.selectedNumber) || !Number.isInteger(state.selectedBet);
  }

  $('confirm-choice').addEventListener('click', async () => {
    if (!Number.isInteger(state.selectedNumber) || !Number.isInteger(state.selectedBet)) return;
    try {
      if (state.demo) {
        if (players().some(player => player.uid !== state.playerId && player.ready && player.bet === state.selectedBet)) { toast('Esse palpite já foi reservado. Escolha outro.'); state.selectedBet = null; renderRoom(); return; }
        state.room.players[state.playerId] = { ...state.room.players[state.playerId], number: state.selectedNumber, bet: state.selectedBet, ready: true };
        if (players().every(player => player.ready)) { state.room.phase = 'countdown'; state.room.countdownEndsAt = Date.now() + 5000; }
        renderRoom(); maybeAdvance();
      } else {
        state.room = await action('confirm', { number: state.selectedNumber, bet: state.selectedBet, playerToken: state.playerToken });
        renderRoom(); maybeAdvance();
      }
    } catch (error) { toast(readableError(error)); state.selectedBet = null; renderRoom(); }
  });

  function renderResult(list) {
    const sum = Number.isFinite(state.room.sum) ? state.room.sum : list.reduce((total, player) => total + (Number(player.number) || 0), 0);
    $('result-sum').textContent = sum;
    const winners = list.filter((player) => player.bet === sum);
    $('result-copy').textContent = winners.length ? `Acertou${winners.length > 1 ? 'ram' : ''}: ${winners.map(player => player.name).join(', ')}!` : 'Ninguém acertou desta vez.';
    $('revealed-players').innerHTML = list.map((player) => `<span class="reveal-chip ${player.bet === sum ? 'winner' : ''}">${escapeHtml(player.name)} · escolheu ${player.number} · apostou ${player.bet}</span>`).join('');
    $('next-round').classList.toggle('hidden', !isHost());
  }

  $('start-round').addEventListener('click', () => hostAction('start'));
  $('next-round').addEventListener('click', () => hostAction('next'));
  $('copy-code').addEventListener('click', async () => { try { await navigator.clipboard.writeText(state.roomCode); toast('Código copiado'); } catch { toast(`Código da sala: ${state.roomCode}`); } });
  $('share-room').addEventListener('click', async () => {
    const invite = { title: 'PORRINH4', text: `Entre na minha sala do PORRINH4. Código: ${state.roomCode}`, url: location.href };
    try { if (navigator.share) await navigator.share(invite); else { await navigator.clipboard.writeText(`${invite.text} ${invite.url}`); toast('Convite copiado'); } } catch {}
  });
  function leaveRoom(showHome = true) {
    clearInterval(state.timer); clearInterval(state.displayTimer); state.timer = null; state.displayTimer = null;
    if (state.channel && state.supabase) state.supabase.removeChannel(state.channel);
    state.channel = null; state.roomCode = null; state.room = null; state.demo = false;
    if (showHome) { $('room-view').classList.add('hidden'); $('home-view').classList.remove('hidden'); }
  }
  $('leave-room').addEventListener('click', () => leaveRoom());
  $('practice-game').addEventListener('click', startPractice);
  $('create-room').addEventListener('click', createRoom);
  $('join-room').addEventListener('click', joinRoom);
  $('room-code-input').addEventListener('input', (event) => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); });
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
})();
