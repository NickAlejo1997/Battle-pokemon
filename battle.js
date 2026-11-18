(() => {
    const API = "https://pokeapi.co/api/v2";
    const MAX_TEAM_SIZE = 6;
    const TYPES = {
        normal:"Normal",fire:"Fuego",water:"Agua",electric:"Eléctrico",grass:"Planta",ice:"Hielo",fighting:"Lucha",poison:"Veneno",ground:"Tierra",flying:"Volador",psychic:"Psíquico",bug:"Bicho",rock:"Roca",ghost:"Fantasma",dragon:"Dragón",dark:"Siniestro",steel:"Acero",fairy:"Hada"
    };
    const TYPE_COLORS = { normal:"#858276",fire:"#dc593b",water:"#3288bd",electric:"#c19b16",grass:"#4c9c53",ice:"#54aaa9",fighting:"#a63d39",poison:"#92518e",ground:"#ad8e45",flying:"#7e70bc",psychic:"#ad4e83",bug:"#829313",rock:"#8d7b2b",ghost:"#625080",dragon:"#6046c7",dark:"#51443b",steel:"#77778c",fairy:"#bd6e91" };
    const $ = id => document.getElementById(id);
    const views = ["vistaMenu","vistaOnline","vistaSala","vistaBatalla"];
    let socket, socketUid = null, trainer = "", room = null, role = null, team = [], roomState = null, mode = "", socketReady = false, actionLocked = false, typingTimer = null;
    let shownState = null, activeTab = "fight", audioContext = null, musicTimer = null, musicStep = 0, animationChain = Promise.resolve();
    const audioOptions = { music:localStorage.getItem("pokemon-music")!=="off", sfx:localStorage.getItem("pokemon-sfx")!=="off" };
    const clone = value => structuredClone(value);
    const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));

    function showView(name) { views.forEach(id => $(id).classList.toggle("oculto", id !== name)); }
    function updateHeaderRoute(active) {
        $("navApi").setAttribute("aria-current",active==="api"?"page":"false");
        $("navBattle").setAttribute("aria-current",active==="battle"?"page":"false");
        $("sidebarDex").classList.toggle("is-active",active==="api");
        $("sidebarBattle").classList.toggle("is-active",active==="battle");
    }
    function showDexRoute(target="pokemonSearch") {
        if(!$("juego").classList.contains("oculto")) {
            if(mode==="online"&&room&&socket?.readyState===WebSocket.OPEN)send("leave_room");
            mode="";room=null;role=null;roomState=null;shownState=null;actionLocked=false;team=[];
            if(musicTimer){clearInterval(musicTimer);musicTimer=null;}
            $("juego").classList.add("oculto");
        }
        $("inicio").classList.remove("oculto");updateHeaderRoute("api");
        requestAnimationFrame(()=>$(target).scrollIntoView({behavior:"smooth",block:"start"}));
    }
    function openBattleHome() {
        initAudio();$("inicio").classList.add("oculto");$("juego").classList.remove("oculto");showView("vistaMenu");updateHeaderRoute("battle");
        requestAnimationFrame(()=>$('juego').scrollIntoView({behavior:"smooth",block:"start"}));
    }
    function showBattleRoute() {
        if($("juego").classList.contains("oculto"))openBattleHome();
        else if($("vistaMenu").classList.contains("oculto")&&$("vistaOnline").classList.contains("oculto")&&$("vistaSala").classList.contains("oculto")&&$("vistaBatalla").classList.contains("oculto"))showView("vistaMenu");
        updateHeaderRoute("battle");requestAnimationFrame(()=>$("juego").scrollIntoView({behavior:"smooth",block:"start"}));
    }
    function setText(id, value) { $(id).textContent = value; }
    function initAudio() {
        if(!audioContext) audioContext=new (window.AudioContext||window.webkitAudioContext)();
        if(audioContext.state==="suspended")audioContext.resume();
        syncMusic();
    }
    function tone(frequency,duration=.12,shape="square",volume=.035) {
        if(!audioOptions.sfx||!audioContext)return;
        const osc=audioContext.createOscillator(),gain=audioContext.createGain(),now=audioContext.currentTime;
        osc.type=shape;osc.frequency.setValueAtTime(frequency,now);gain.gain.setValueAtTime(volume,now);gain.gain.exponentialRampToValueAtTime(.001,now+duration);osc.connect(gain);gain.connect(audioContext.destination);osc.start(now);osc.stop(now+duration);
    }
    function playSfx(name) {
        if(!audioOptions.sfx)return;
        if(!audioContext)initAudio();
        const patterns={click:[[520,.06]],lunge:[[310,.16],[180,.12]],hit:[[110,.2],[80,.14]],critical:[[660,.09],[880,.18]],win:[[523,.12],[659,.12],[784,.22]],faint:[[330,.18],[220,.28]]};
        let offset=0;for(const [hz,duration] of patterns[name]||patterns.click){setTimeout(()=>tone(hz,duration,name==="hit"?"sawtooth":"square",name==="hit"?.055:.025),offset);offset+=duration*700;}
    }
    function syncMusic() {
        if(!audioOptions.music){clearInterval(musicTimer);musicTimer=null;return;}
        if(!audioContext||musicTimer)return;
        const notes=[392,494,587,494,440,587,659,587,392,494,587,784,659,587,494,440];
        musicTimer=setInterval(()=>{if(audioOptions.music&&audioContext?.state==="running"){const osc=audioContext.createOscillator(),gain=audioContext.createGain(),now=audioContext.currentTime;osc.type="square";osc.frequency.value=notes[musicStep++%notes.length];gain.gain.setValueAtTime(.008,now);gain.gain.exponentialRampToValueAtTime(.001,now+.16);osc.connect(gain);gain.connect(audioContext.destination);osc.start(now);osc.stop(now+.17);}},210);
    }
    function say(text) { return new Promise(resolve=>{const el=$("battleNarration");if(typingTimer)clearInterval(typingTimer);el.textContent="";let i=0;typingTimer=setInterval(()=>{el.textContent+=text[i++]||"";if(i>text.length){clearInterval(typingTimer);resolve();}},15);}); }
    async function api(url) { const r = await fetch(url); if (!r.ok) throw new Error(`PokéAPI respondió ${r.status}`); return r.json(); }
    function spanishName(item, fallback) { return item?.names?.find(n => n.language.name === "es")?.name || fallback; }
    function stat(pokemon, name) { return pokemon.stats.find(s => s.stat.name === name)?.base_stat || 1; }
    function moveLabel(name) { return name.replaceAll("-", " ").replace(/\b\w/g, c => c.toUpperCase()); }
    function makeSprite(p) {
        const versions = p.sprites.versions?.["generation-v"]?.["black-white"]?.animated;
        const back = versions?.back_default || p.sprites.back_default;
        const frontAnimated = versions?.front_default;
        return { back: back || p.sprites.front_default, front: frontAnimated || p.sprites.front_default, fallbackFlip: !back && !!p.sprites.front_default };
    }
    async function loadBattlePokemon(query) {
        const raw = await api(`${API}/pokemon/${encodeURIComponent(query.trim().toLowerCase())}`);
        const species = await api(raw.species.url);
        const available = raw.moves.map(m => m.move).sort(()=>Math.random()-.5).slice(0,24);
        const moveData = await Promise.all(available.map(async ref=>{try{return await api(ref.url);}catch{return null;}}));
        const chosen = moveData.filter(info=>info&&(info.power||0)>0&&info.damage_class.name!=="status").slice(0,4).map(info=>({key:info.name,name:spanishName(info,moveLabel(info.name)),type:info.type.name,power:info.power,accuracy:info.accuracy||100,pp:info.pp,ppLeft:info.pp,damageClass:info.damage_class.name}));
        if (!chosen.length) throw new Error(`${raw.name} no tiene movimientos ofensivos disponibles`);
        const abilityRef = raw.abilities[0]?.ability;
        let ability = "Sin habilidad";
        if (abilityRef) { try { const a = await api(abilityRef.url); ability = spanishName(a, moveLabel(a.name)); } catch { ability = moveLabel(abilityRef.name); } }
        const speciesName = spanishName(species, moveLabel(raw.name));
        const maxHp = Math.floor(((2*stat(raw,"hp")+31)*50)/100)+60;
        return { id:raw.id,name:speciesName,apiName:raw.name,types:raw.types.map(t=>t.type.name),stats:{hp:maxHp,attack:Math.floor(((2*stat(raw,"attack")+31)*50)/100)+5,defense:Math.floor(((2*stat(raw,"defense")+31)*50)/100)+5,specialAttack:Math.floor(((2*stat(raw,"special-attack")+31)*50)/100)+5,specialDefense:Math.floor(((2*stat(raw,"special-defense")+31)*50)/100)+5,speed:Math.floor(((2*stat(raw,"speed")+31)*50)/100)+5},ability,moves:chosen,sprites:makeSprite(raw),maxHp,currentHp:maxHp };
    }
    async function randomPokemon(excluded=[]) {
        for (let i=0;i<12;i++) { const id=Math.floor(Math.random()*1025)+1; if (excluded.includes(id)) continue; try { return await loadBattlePokemon(String(id)); } catch { /* prueba otro Pokémon */ } }
        throw new Error("No se pudo completar el equipo aleatorio. Inténtalo de nuevo.");
    }
    let battlePokemonIndexPromise;
    function getBattlePokemonIndex() {
        if(typeof listaPokemon!=="undefined"&&listaPokemon.length)return Promise.resolve(listaPokemon);
        if(!battlePokemonIndexPromise)battlePokemonIndexPromise=api(`${API}/pokemon?limit=1025`).then(data=>data.results.map(p=>({id:Number(p.url.split("/").filter(Boolean).pop()),nombre:p.name})));
        return battlePokemonIndexPromise;
    }
    async function showBattlePokemonSuggestions(query) {
        const input=$("pokemonEquipoInput"),list=$("battlePokemonSuggestions"),value=query.trim().toLowerCase();
        input.dataset.pokemonId="";list.replaceChildren();
        if(!value){list.classList.add("oculto");return;}
        list.classList.remove("oculto");const loading=document.createElement("div");loading.className="battle-search-message";loading.textContent="Buscando Pokémon…";list.append(loading);
        try {
            const index=await getBattlePokemonIndex();if(input.value.trim().toLowerCase()!==value)return;
            const starts=index.filter(p=>p.nombre.startsWith(value)||String(p.id).startsWith(value)),contains=/^\d+$/.test(value)?[]:index.filter(p=>!starts.includes(p)&&p.nombre.includes(value)),matches=[...starts,...contains].slice(0,8);
            list.replaceChildren();
            if(!matches.length){const empty=document.createElement("div");empty.className="battle-search-message";empty.textContent="Sin resultados";list.append(empty);return;}
            matches.forEach(p=>{
                const option=document.createElement("button");option.type="button";option.className="battle-search-option";option.setAttribute("role","option");
                const sprite=document.createElement("img");sprite.src=`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${p.id}.png`;sprite.alt="";sprite.loading="lazy";
                const name=document.createElement("span");name.textContent=p.nombre.replaceAll("-"," ");const number=document.createElement("small");number.textContent=`#${String(p.id).padStart(4,"0")}`;
                option.append(sprite,name,number);option.addEventListener("click",()=>{input.value=p.nombre;input.dataset.pokemonId=String(p.id);list.classList.add("oculto");showNotice(`Vista previa seleccionada: ${p.nombre} (#${p.id}). Pulsa “Buscar y Agregar Pokémon” para añadirlo.`);});list.append(option);
            });
        } catch {list.replaceChildren();const error=document.createElement("div");error.className="battle-search-message";error.textContent="No se pudo cargar la lista. Escribe el nombre o número completo.";list.append(error);}
    }
    function renderTeam() {
        const el=$("equipoSeleccionado"); el.innerHTML="";
        team.forEach((p,index)=>{ const row=document.createElement("div"); row.className="team-pick"; const img=document.createElement("img"); img.src=p.sprites.front; img.alt=""; const text=document.createElement("div"); const strong=document.createElement("strong"); strong.textContent=`${index+1}. ${p.name}`; const small=document.createElement("small"); small.textContent=`Habilidad: ${p.ability} · ${p.moves.map(m=>`${m.name} (${TYPES[m.type]||m.type}, ${m.power} de potencia, ${m.accuracy}% precisión, ${m.pp} PP, ${m.damageClass})`).join(" · ")}`; text.append(strong,small); const remove=document.createElement("button"); remove.className="remove-pokemon"; remove.textContent="Quitar"; remove.disabled=roomState?.players?.some?.(x=>x.socketId===socketUid)&&roomState?.ready?.includes?.(socketUid); remove.addEventListener("click",()=>{team.splice(index,1);renderTeam();}); row.append(img,text,remove); el.append(row); });
        if (!team.length) el.innerHTML='<p class="empty-state">Agrega entre 1 y 6 Pokémon para continuar.</p>';
    }
    function showNotice(text) { setText("onlineMensaje",text); setText("estadoSala",text); }

    async function addPokemon(query) {
        if (team.length>=MAX_TEAM_SIZE) { showNotice("El equipo ya tiene 6 Pokémon."); return; }
        const button=$("btnAgregarPokemon"); button.disabled=true;
        try { const p=await loadBattlePokemon(query); if(team.some(x=>x.id===p.id)) throw new Error("Ese Pokémon ya está en el equipo."); team.push(p); renderTeam(); $("pokemonEquipoInput").value="";$("pokemonEquipoInput").dataset.pokemonId="";$("battlePokemonSuggestions").classList.add("oculto"); showNotice(`${p.name} se unió al equipo.`); }
        catch(e) { showNotice(e.message || "No se pudo cargar el Pokémon."); }
        finally { button.disabled=false; }
    }
    async function fillRandom() {
        const button=$("btnEquipoRandom"); button.disabled=true; team=[]; renderTeam();
        try { for(let i=0;i<MAX_TEAM_SIZE;i++){ const p=await randomPokemon(team.map(x=>x.id)); team.push(p);renderTeam(); } showNotice("Equipo aleatorio listo."); }
        catch(e){showNotice(e.message);}
        finally{button.disabled=false;}
    }
    function connect() {
        if (socket?.readyState===WebSocket.OPEN) { socketReady=true; enterLobby(); return; }
        if (socket?.readyState===WebSocket.CONNECTING) return;
        const wsProtocol=window.location.protocol==="https:"?"wss:":"ws:";
        const wsHost=window.location.hostname||"localhost";
        socket=new WebSocket(`${wsProtocol}//${wsHost}:3000`);
        socket.addEventListener("open",()=>{socketReady=true;setText("estadoServidor","Servidor conectado.");socket.send(JSON.stringify({type:"identify",name:trainer}));if(!$("vistaOnline").classList.contains("oculto"))enterLobby();});
        socket.addEventListener("message",e=>{let data;try{data=JSON.parse(e.data);}catch{return;} onServerMessage(data);});
        socket.addEventListener("close",()=>{socketReady=false;actionLocked=false;setText("estadoServidor","Servidor desconectado. Comprueba que el anfitrión mantenga server.js en ejecución y vuelve a pulsar Entrar al lobby.");if(room)showNotice("Se perdió la conexión con la sala. Vuelve al lobby para reconectar.");});
        socket.addEventListener("error",()=>setText("estadoServidor","No se pudo conectar. Comprueba el servidor y el puerto 3000; puedes reintentar desde el lobby."));
    }
    function send(type,payload={}) { if(socket?.readyState===WebSocket.OPEN) socket.send(JSON.stringify({type,roomId:room,...payload})); }
    function enterLobby() { trainer=$("nombreEntrenador").value.trim() || `Entrenador #${Math.floor(100+Math.random()*900)}`; $("nombreEntrenador").value=trainer; send("identify",{name:trainer}); $("lobbyContenido").classList.remove("oculto"); showNotice("Estás en el lobby. Crea una sala o elige una disponible."); }
    function onServerMessage(msg) {
        if(msg.type==="rooms") { renderRooms(msg.rooms); return; }
        if(msg.type==="error") { actionLocked=false;showNotice(msg.message);if(roomState?.phase==="in_battle")renderBattle(roomState,[],{skipNarration:true});return; }
        if(msg.type==="joined") { room=msg.roomId; role=msg.role; socketUid=msg.socketId; roomState=msg.state;shownState=null;activeTab="fight";actionLocked=false; team=[]; renderTeam(); showView("vistaSala"); $("salaEtiqueta").textContent=`SALA ${room}`; $("salaTitulo").textContent=role==="spectator"?"Transmisión en vivo":"Preparación del equipo"; $("equipoEditor").classList.toggle("oculto",role==="spectator"); $("infoEspectador").classList.toggle("oculto",role!=="spectator"); renderRoomState(); if(msg.state.phase==="in_battle") renderBattle(msg.state); return; }
        if(msg.type==="room_state") { roomState=msg.state; renderRoomState(); return; }
        if(msg.type==="battle_state") { showView("vistaBatalla");roomState=msg.state;if(msg.events?.length){actionLocked=true;animationChain=animationChain.then(()=>playBattleRound(shownState?clone(shownState):null,msg.state,msg.events,msg.log)).catch(()=>{actionLocked=false;shownState=clone(msg.state);renderBattle(msg.state,msg.log);});}else{actionLocked=false;shownState=clone(msg.state);renderBattle(msg.state,msg.log);if(msg.state.phase==="finished")playSfx("win");}return; }
        if(msg.type==="spectators_updated") { if(roomState)roomState.spectators=msg.spectators; updateSpectators(msg.spectators); return; }
        if(msg.type==="battle_log") { renderBattle(roomState,msg.log); return; }
        if(msg.type==="left") { room=null;roomState=null;shownState=null;role=null;team=[];actionLocked=false;showView("vistaOnline"); }
    }
    function renderRooms(rooms) {
        const list=$("listaSalas"); list.innerHTML="";
        if(!rooms.length){list.innerHTML='<p class="empty-state">No hay salas disponibles todavía. Crea una batalla para empezar.</p>';return;}
        rooms.forEach(r=>{const row=document.createElement("div");row.className="room-item";const info=document.createElement("div");const title=document.createElement("strong");title.textContent=r.phase==="waiting_players"?"Esperando rival (1/2)":r.phase==="preparing"?"Preparando batalla (2/2)":`${r.playerNames[0]||"Jugador 1"} vs ${r.playerNames[1]||"Jugador 2"}`;const sub=document.createElement("small");sub.textContent=r.phase==="in_battle"?`En batalla · 👁️ ${r.spectatorCount} espectadores`:`Creada por ${r.playerNames[0]||"Entrenador"}`;info.append(title,sub);const btn=document.createElement("button");btn.textContent=r.phase==="in_battle"?"Ver Batalla":r.phase==="preparing"?"Preparando…":"Unirse a pelear";btn.className=r.phase==="in_battle"||r.phase==="preparing"?"secundario":"";btn.disabled=r.phase==="preparing";btn.addEventListener("click",()=>send(r.phase==="in_battle"?"spectate":"join_room",{roomId:r.roomId}));row.append(info,btn);list.append(row);});
    }
    function renderRoomState() {
        if(!roomState)return;
        const names=(roomState.players||[]).map(p=>p.name);
        setText("salaTitulo",roomState.phase==="waiting_players"?`Sala ${room} · esperando rival`:names.join(" vs ")||`Sala ${room}`);
        if(role==="spectator"){showView(roomState.phase==="in_battle"?"vistaBatalla":"vistaSala");return;}
        const isReady=roomState.ready?.includes(socketUid);
        $("equipoEditor").classList.toggle("oculto",isReady);
        if(roomState.phase==="waiting_players") showNotice(isReady?"Esperando al otro jugador…":roomState.players.length<2?"Esperando que se una otro entrenador. Puedes ir armando tu equipo.":"El otro entrenador está en la sala. Prepara tu equipo y pulsa Empezar Batalla.");
        else if(roomState.phase==="ready") showNotice(isReady?"Esperando al otro jugador…":"El rival está listo. Prepara tu equipo y pulsa Empezar Batalla.");
        if(roomState.phase==="in_battle")showView("vistaBatalla");
    }

    function renderBattle(state, log=[], options={}) {
        if(!state)return; roomState=state;
        if(!options.intermediate)shownState=clone(state);
        const players=state.players||[]; let ownIndex=players.findIndex(p=>p.socketId===socketUid); if(role==="spectator"||ownIndex<0)ownIndex=0;
        const enemyIndex=1-ownIndex; const own=players[ownIndex],enemy=players[enemyIndex];
        if(mode==="cpu"&&state.cpu){ownIndex=0;}
        const me=players[ownIndex], rival=players[enemyIndex];
        setText("battleRoomLabel",mode==="cpu"?"BATALLA LOCAL":`SALA ${room}`);setText("battleTitle",`${me?.name||"Jugador 1"} vs ${rival?.name||"Jugador 2"}`);
        setText("playerTrainer",me?.name||"Jugador");setText("enemyTrainer",rival?.name||"Rival");
        const ownP=me?.team?.[me.activeIndex||0], enemyP=rival?.team?.[rival.activeIndex||0];
        const hpAnimations=[paintFighter("player",ownP,true,options.animateHP),paintFighter("enemy",enemyP,false,options.animateHP)];
        renderPokeballs("playerBallCount",me);renderPokeballs("enemyBallCount",rival);
        updateSpectators(state.spectators||[]);
        const last=Array.isArray(log)?log.slice(-3):[]; if(last.length&&!options.skipNarration)typeText(last.map(x=>typeof x==="string"?x:x.text).join(" "));
        renderActions(me,ownP,ownIndex);
        if(options.animateHP)return Promise.all(hpAnimations);
    }
    function renderPokeballs(containerId,player) {
        const container=$(containerId);container.replaceChildren();
        for(let i=0;i<6;i++){
            const ball=document.createElement("span");ball.className="pokeball-icon";
            if(i>=(player?.team?.length||0))ball.classList.add("empty");
            else if(player.team[i].currentHp<=0)ball.classList.add("fainted");
            else ball.classList.add("alive");
            if(i===(player?.activeIndex||0)&&i<(player?.team?.length||0))ball.classList.add("active");
            ball.title=i>=(player?.team?.length||0)?"Espacio vacío":player.team[i].currentHp<=0?`${player.team[i].name}: debilitado`:`${player.team[i].name}: disponible`;
            container.append(ball);
        }
    }
    function paintFighter(which,p,back,animateHP=false) {
        const name=$(which+"Name"),sprite=$(which+"Sprite"),bar=$(which+"HpBar"),hpText=$(which+"HpText");
        if(!p){name.textContent="—";sprite.removeAttribute("src");sprite.dataset.pokemon="";sprite.dataset.hp="";bar.style.width="0";hpText.textContent="";return;}
        name.textContent=p.name;const image=back?(p.sprites?.back||p.sprites?.front):(p.sprites?.front||p.sprites?.back);if(sprite.getAttribute("src")!==(image||""))sprite.src=image||"";$(which+"SpriteWrapper").classList.toggle("sprite-flipped",!!(back&&p.sprites?.fallbackFlip));
        if(sprite.dataset.pokemon!==String(p.id)||p.currentHp>0)sprite.classList.remove("battle-faint");
        const samePokemon=sprite.dataset.pokemon===String(p.id),previous=Number(hpText.dataset.current??p.currentHp),percent=Math.max(0,(p.currentHp/p.maxHp)*100);
        sprite.dataset.pokemon=String(p.id);sprite.dataset.hp=String(p.currentHp);
        bar.style.width=`${percent}%`;bar.classList.toggle("hp-critical",percent<20);bar.style.background=percent>50?"#22c55e":percent>=20?"#eab308":"#ef4444";
        if(animateHP&&samePokemon&&p.currentHp<previous){
            const start=performance.now(),duration=600;
            return new Promise(resolve=>{const frame=now=>{const progress=Math.min(1,(now-start)/duration),ease=1-Math.pow(1-progress,3),current=Math.round(previous+(p.currentHp-previous)*ease);hpText.textContent=`${current} / ${p.maxHp} PS`;if(progress<1)requestAnimationFrame(frame);else{hpText.textContent=`${p.currentHp} / ${p.maxHp} PS`;hpText.dataset.current=String(p.currentHp);resolve();}};hpText.dataset.current=String(p.currentHp);requestAnimationFrame(frame);});
        }
        hpText.textContent=`${Math.max(0,p.currentHp)} / ${p.maxHp} PS`;hpText.dataset.current=String(p.currentHp);
    }
    function typeText(text) { say(text); }
    function uiSideForPlayer(index,state) {
        if(mode==="cpu"||role==="spectator")return index===0?"player":"enemy";
        return state.players[index]?.socketId===socketUid?"player":"enemy";
    }
    function spriteFor(side) { return $(side==="player"?"playerSprite":"enemySprite"); }
    const LUNGE_DURATION=450, LUNGE_IMPACT=Math.round(LUNGE_DURATION*.65);
    async function playBattleRound(previous,next,events,logs=[]) {
        const frame=clone(previous||next);
        if(!previous)renderBattle(frame,[],{intermediate:true,skipNarration:true});
        for(let i=0;i<events.length;i++) {
            const event=events[i];
            if(event.kind==="switch") {
                frame.players[event.playerIndex].activeIndex=event.toIndex;
                if(uiSideForPlayer(event.playerIndex,frame)==="player")activeTab="fight";
                renderBattle(frame,[],{intermediate:true,skipNarration:true});
                playSfx("click");await say(event.text);await wait(200);continue;
            }
            if(event.kind!=="attack")continue;
            const attackerSide=uiSideForPlayer(event.playerIndex,frame),defenderSide=uiSideForPlayer(event.defenderIndex,frame);
            const attackerSprite=spriteFor(attackerSide),defenderSprite=spriteFor(defenderSide),attackerFighter=attackerSprite.closest(".fighter");
            await say(`¡${event.attackerName} usó ${event.moveName}!`);
            attackerSprite.classList.remove("anim-lunge-player","anim-lunge-enemy");void attackerSprite.offsetWidth;
            attackerFighter?.classList.add("attacking");attackerSprite.classList.add(attackerSide==="player"?"anim-lunge-player":"anim-lunge-enemy");playSfx("lunge");
            await wait(LUNGE_IMPACT);
            if(!event.missed) {
                defenderSprite.classList.remove("impact-recoil","battle-shake","battle-flash");void defenderSprite.offsetWidth;
                defenderSprite.classList.add("impact-recoil","battle-flash");playSfx(event.critical?"critical":"hit");
                const target=frame.players[event.defenderIndex].team.find(p=>p.id===event.defenderPokemonId);
                if(target){target.currentHp=event.hpAfter;await Promise.all([renderBattle(frame,[],{intermediate:true,skipNarration:true,animateHP:true}),wait(700)]);}
                else await wait(LUNGE_DURATION-LUNGE_IMPACT);
            } else {
                await wait(LUNGE_DURATION-LUNGE_IMPACT);
            }
            attackerFighter?.classList.remove("attacking");attackerSprite.classList.remove("anim-lunge-player","anim-lunge-enemy");
            if(event.missed){await say(`¡El ataque de ${event.attackerName} falló!`);if(events.slice(i+1).some(e=>e.kind==="attack"))await wait(500);continue;}
            const messages=[];
            if(event.critical)messages.push("¡Un golpe crítico!");
            if(event.effectiveness===0)messages.push(`No afecta a ${event.defenderName}…`);
            else if(event.effectiveness>=2)messages.push("¡Es súper eficaz!");
            else if(event.effectiveness>0&&event.effectiveness<1)messages.push("No es muy eficaz…");
            if(event.damage>0)messages.push(`${event.defenderName} perdió ${event.damage} PS.`);
            if(event.hpAfter===0){messages.push(`¡${event.defenderName} se debilitó!`);playSfx("faint");defenderSprite.classList.add("battle-faint");}
            if(messages.length)await say(messages.join(" "));
            if(event.hpAfter===0)await wait(620);
            else if(events.slice(i+1).some(e=>e.kind==="attack"))await wait(500);
        }
        actionLocked=false;shownState=clone(next);renderBattle(next,[],{skipNarration:true});
        if(next.phase==="finished"&&next.winner)playSfx("win");
    }
    function updateSpectators(spectators) { spectators=spectators||[];setText("spectatorWidget",`👁️ Espectadores (${spectators.length})`);setText("spectatorNames",spectators.length?spectators.map(s=>s.name).join(", "):"Sin espectadores por ahora"); }
    function renderActions(me,active,ownIndex) {
        const actions=$("battleActions");actions.innerHTML="";
        const spectator=role==="spectator",players=roomState?.players||[],isCpu=mode==="cpu";
        if(spectator){const banner=document.createElement("div");banner.className="spectator-banner";banner.textContent="Solo lectura · Observando la ronda en vivo";const back=document.createElement("button");back.id="btnLobbyDesdeBatalla";back.className="secundario";back.textContent="Volver al Lobby";back.onclick=()=>send("leave_room");actions.append(banner,back);return;}
        if(roomState?.phase==="finished"){const result=document.createElement("strong");result.className="battle-result";result.textContent=roomState.winner?`${roomState.winner} ganó el combate`:"Combate finalizado";const back=document.createElement("button");back.textContent=isCpu?"Volver al menú":"Volver al lobby";back.className="secundario";back.onclick=()=>{if(isCpu){mode="";showView("vistaMenu");}else send("leave_room");};actions.append(result,back);return;}
        if(!active)return;
        if(!isCpu&&players.length<2){actions.textContent="Esperando rival…";return;}
        if(!isCpu&&role!=="player")return;
        const forced=active.currentHp<=0;if(forced)activeTab="team";
        const command=document.createElement("div");command.className="battle-command";
        const tabs=document.createElement("div");tabs.className="battle-tabs";
        const fightTab=document.createElement("button");fightTab.type="button";fightTab.textContent="⚔️ Luchar";fightTab.setAttribute("aria-selected",String(activeTab==="fight"));fightTab.disabled=forced||actionLocked;fightTab.onclick=()=>{activeTab="fight";playSfx("click");renderActions(me,active,ownIndex);};
        const teamTab=document.createElement("button");teamTab.type="button";teamTab.textContent="🔄 Equipo (Cambiar)";teamTab.setAttribute("aria-selected",String(activeTab==="team"));teamTab.disabled=actionLocked;teamTab.onclick=()=>{activeTab="team";playSfx("click");renderActions(me,active,ownIndex);};tabs.append(fightTab,teamTab);command.append(tabs);
        if(forced){const prompt=document.createElement("div");prompt.className="battle-command-note";prompt.textContent=`${active.name} está debilitado. Elige un Pokémon vivo para continuar.`;command.append(prompt);}
        const options=document.createElement("div");options.className="battle-options";
        if(activeTab==="fight"&&!forced){
            const outOfPp=active.moves.every(move=>(move.ppLeft??move.pp)<=0);
            const moves=outOfPp?[{name:"Forcejeo",type:"normal",power:50,accuracy:100,pp:0,ppLeft:0,damageClass:"physical",struggle:true}]:active.moves;
            moves.forEach((move,index)=>{
                const button=document.createElement("button");button.type="button";button.className="move-card";button.style.setProperty("--move-color",TYPE_COLORS[move.type]||"#64748b");
                const name=document.createElement("strong");name.textContent=move.name;
                const tag=document.createElement("span");tag.className="move-type-tag";tag.textContent=TYPES[move.type]||move.type;
                const stats=document.createElement("small"),category=move.damageClass==="physical"?"Físico":"Especial",pp=move.ppLeft??move.pp;
                stats.innerHTML=`<span>${category} · Pot: ${move.power}</span><span>${move.struggle?"PP —":`PP ${pp}/${move.pp}`}</span>`;
                button.append(name,tag,stats);button.disabled=actionLocked||(!move.struggle&&pp<=0);button.title=`Precisión ${move.accuracy}%`;
                button.onclick=()=>{playSfx("click");localOrSend({kind:"move",moveIndex:move.struggle?-1:index},ownIndex);};options.append(button);
            });
        } else {
            me.team.forEach((pokemon,index)=>{
                const button=document.createElement("button");button.type="button";button.className="switch-card";
                const img=document.createElement("img");img.src=pokemon.sprites?.front||"";img.alt="";
                const title=document.createElement("span");title.className="switch-title";title.append(document.createTextNode(`${pokemon.name} · Nv. 50`));
                const state=document.createElement("small"),current=index===me.activeIndex,dead=pokemon.currentHp<=0;
                state.textContent=current?"En combate":dead?"Debilitado":"Sacar al campo";
                const types=document.createElement("span");types.className="switch-types";pokemon.types.forEach(type=>{const badge=document.createElement("span");badge.className="switch-type";badge.style.backgroundColor=TYPE_COLORS[type]||"#64748b";badge.textContent=TYPES[type]||type;types.append(badge);});title.append(types);
                const track=document.createElement("span");track.className="switch-hp";const fill=document.createElement("span"),ratio=Math.max(0,pokemon.currentHp/pokemon.maxHp);fill.style.width=`${ratio*100}%`;fill.style.backgroundColor=ratio>.5?"#22c55e":ratio>=.2?"#eab308":"#ef4444";track.append(fill);
                const hp=document.createElement("small");hp.textContent=`PS ${Math.max(0,pokemon.currentHp)} / ${pokemon.maxHp}`;
                button.append(img,title,state,track,hp);button.disabled=actionLocked||current||dead;
                if(!button.disabled)button.onclick=()=>{playSfx("click");localOrSend({kind:"switch",index},ownIndex);};options.append(button);
            });
        }
        command.append(options);
        const surrender=document.createElement("button");surrender.type="button";surrender.className="surrender-button";surrender.textContent="Rendirse";surrender.disabled=actionLocked;surrender.onclick=()=>{playSfx("click");if(isCpu){roomState.phase="finished";roomState.winner="CPU";renderBattle(roomState,["Te rendiste. La CPU ganó el combate."]);}else send("surrender");};command.append(surrender);
        actions.append(command);
    }
    function localOrSend(action, ownIndex) { if(mode==="cpu") { resolveLocal(action,ownIndex);return; } if(socket?.readyState!==WebSocket.OPEN){actionLocked=false;showNotice("La conexión se cerró. Vuelve al lobby para reconectar.");return;}actionLocked=true;renderBattle(roomState,[],{skipNarration:true});setText("battleNarration","Esperando a que el rival elija su acción…");send(action.kind==="switch"?"switch_pokemon":"select_move",{action}); }
    function effectiveness(moveType,defender) { let multiplier=1;const chart=roomState?.typeChart||{};for(const type of defender.types||[]){const rel=chart[moveType]||{};if((rel.no_damage_to||[]).some(t=>t.name===type))multiplier*=0;else if((rel.half_damage_to||[]).some(t=>t.name===type))multiplier*=.5;else if((rel.double_damage_to||[]).some(t=>t.name===type))multiplier*=2;}return multiplier; }
    function localAttack(attacker,defender,move,playerIndex,defenderIndex) {
        const before=defender.currentHp;
        if(!move.struggle){if((move.ppLeft??move.pp)<=0)return null;move.ppLeft--;}
        if(Math.random()*100>Number(move.accuracy||100))return {kind:"attack",playerIndex,defenderIndex,attackerName:attacker.name,attackerPokemonId:attacker.id,defenderName:defender.name,defenderPokemonId:defender.id,moveName:move.name,missed:true,damage:0,effectiveness:1,critical:false,hpBefore:before,hpAfter:before};
        const physical=move.damageClass==="physical",atk=physical?attacker.stats.attack:attacker.stats.specialAttack,def=Math.max(1,physical?defender.stats.defense:defender.stats.specialDefense),eff=effectiveness(move.type,defender),stab=attacker.types.includes(move.type)?1.5:1,critical=Math.random()<(attacker.stats.speed>=100?.15:.1)?1.5:1;
        const damage=Math.max(eff===0?0:1,Math.floor(((((2*50/5+2)*move.power*(atk/def))/50)+2)*stab*eff*critical*(.85+Math.random()*.15)));
        defender.currentHp=Math.max(0,defender.currentHp-damage);
        return {kind:"attack",playerIndex,defenderIndex,attackerName:attacker.name,attackerPokemonId:attacker.id,defenderName:defender.name,defenderPokemonId:defender.id,moveName:move.name,missed:false,damage,effectiveness:eff,critical:critical>1,hpBefore:before,hpAfter:defender.currentHp};
    }
    async function resolveLocal(action, ownIndex) {
        if(actionLocked)return;
        const before=clone(roomState),players=roomState.players,me=players[ownIndex],enemy=players[1-ownIndex],events=[],logs=[];
        if(action.kind==="switch"){
            const from=me.activeIndex;me.activeIndex=action.index;
            events.push({kind:"switch",playerIndex:ownIndex,toIndex:action.index,fromPokemonId:me.team[from]?.id,toPokemonId:me.team[action.index].id,text:`${me.name} cambió a ${me.team[action.index].name}.`});
            const target=me.team[me.activeIndex],cpu=enemy.team[enemy.activeIndex||0],available=cpu.moves.filter(m=>(m.ppLeft??m.pp)>0),superMoves=available.filter(m=>effectiveness(m.type,target)>1);
            const cpuMove=available.length?(superMoves.length&&Math.random()<.7?superMoves[Math.floor(Math.random()*superMoves.length)]:available[Math.floor(Math.random()*available.length)]):{name:"Forcejeo",type:"normal",power:50,accuracy:100,damageClass:"physical",struggle:true};
            if(cpu.currentHp>0&&target.currentHp>0){const event=localAttack(cpu,target,cpuMove,1,ownIndex);if(event){events.push(event);logs.push(event);}}
        } else {
            const cpu=enemy.team[enemy.activeIndex||0],mine=me.team[me.activeIndex||0],available=cpu.moves.filter(m=>(m.ppLeft??m.pp)>0),superMoves=available.filter(m=>effectiveness(m.type,mine)>1);
            const cpuMove=available.length?(superMoves.length&&Math.random()<.7?superMoves[Math.floor(Math.random()*superMoves.length)]:available[Math.floor(Math.random()*available.length)]):{name:"Forcejeo",type:"normal",power:50,accuracy:100,damageClass:"physical",struggle:true};
            const playerMove=action.moveIndex===-1?{name:"Forcejeo",type:"normal",power:50,accuracy:100,damageClass:"physical",struggle:true}:mine.moves[action.moveIndex];
            let first={pokemon:mine,target:cpu,move:playerMove,playerIndex:ownIndex,defenderIndex:1-ownIndex},second={pokemon:cpu,target:mine,move:cpuMove,playerIndex:1-ownIndex,defenderIndex:ownIndex};
            if(cpu.stats.speed>mine.stats.speed||(cpu.stats.speed===mine.stats.speed&&Math.random()<.5))[first,second]=[second,first];
            for(const turn of [first,second]){
                if(turn.pokemon.currentHp<=0||turn.target.currentHp<=0)continue;
                const event=localAttack(turn.pokemon,turn.target,turn.move,turn.playerIndex,turn.defenderIndex);if(event){events.push(event);logs.push(event);}
            }
        }
        if(enemy.team[enemy.activeIndex||0].currentHp<=0&&enemy.team.some(p=>p.currentHp>0)){
            const from=enemy.activeIndex;enemy.activeIndex=enemy.team.findIndex(p=>p.currentHp>0);events.push({kind:"switch",playerIndex:1-ownIndex,toIndex:enemy.activeIndex,fromPokemonId:enemy.team[from]?.id,toPokemonId:enemy.team[enemy.activeIndex].id,text:`La CPU envió a ${enemy.team[enemy.activeIndex].name}.`});
        }
        if(me.team.every(p=>p.currentHp<=0)||enemy.team.every(p=>p.currentHp<=0)){
            roomState.phase="finished";roomState.winner=enemy.team.every(p=>p.currentHp<=0)?me.name:enemy.name;logs.push({text:`${roomState.winner} ganó el combate.`});
        }
        const next=clone(roomState);actionLocked=true;
        animationChain=animationChain.then(()=>playBattleRound(before,next,events,logs)).catch(()=>{actionLocked=false;renderBattle(next,logs);});
    }
    $("toggleMusic").checked=audioOptions.music;$("toggleSfx").checked=audioOptions.sfx;
    $("toggleMusic").addEventListener("change",event=>{audioOptions.music=event.target.checked;localStorage.setItem("pokemon-music",audioOptions.music?"on":"off");if(audioOptions.music)initAudio();else syncMusic();});
    $("toggleSfx").addEventListener("change",event=>{audioOptions.sfx=event.target.checked;localStorage.setItem("pokemon-sfx",audioOptions.sfx?"on":"off");if(audioOptions.sfx)initAudio();});
    $("btnAbrirJuego").addEventListener("click",()=>{initAudio();$("inicio").classList.add("oculto");$("juego").classList.remove("oculto");showView("vistaMenu");updateHeaderRoute("battle");requestAnimationFrame(()=>$("juego").scrollIntoView({behavior:"smooth",block:"start"})); });
    $("quickLocalBattle").addEventListener("click",()=>{$("btnAbrirJuego").click();$("btnModoCpu").click();});
    $("quickOnlineBattle").addEventListener("click",()=>{$("btnAbrirJuego").click();$("btnModoOnline").click();});
    $("btnVolverPokedex").addEventListener("click",()=>showDexRoute("inicio"));
    $("navHome").addEventListener("click",event=>{event.preventDefault();showDexRoute("inicio");});
    $("navApi").addEventListener("click",()=>showDexRoute("pokemonSearch"));
    $("navBattle").addEventListener("click",showBattleRoute);
    $("sidebarDex").addEventListener("click",()=>showDexRoute("pokemonSearch"));
    $("sidebarBattle").addEventListener("click",showBattleRoute);
    document.querySelectorAll(".volver-menu").forEach(b=>b.addEventListener("click",()=>showView("vistaMenu")));
    $("btnModoCpu").addEventListener("click",()=>{mode="cpu";role="player";roomState=null;shownState=null;activeTab="fight";actionLocked=false;team=[];renderTeam();showView("vistaSala");$("equipoEditor").classList.remove("oculto");$("infoEspectador").classList.add("oculto");$("salaTitulo").textContent="Prepara tu equipo";$("salaEtiqueta").textContent="LOCAL VS. CPU";setText("estadoSala","Agrega de 1 a 6 Pokémon o usa Equipo Random.");});
    $("btnModoOnline").addEventListener("click",()=>{mode="online";showView("vistaOnline");});
    $("btnConectar").addEventListener("click",()=>{trainer=$("nombreEntrenador").value.trim()||`Entrenador #${Math.floor(100+Math.random()*900)}`;connect();if(socket?.readyState===WebSocket.OPEN)enterLobby();});
    $("btnCrearSala").addEventListener("click",()=>{mode="online";send("create_room");});
    $("btnUnirseSala").addEventListener("click",()=>send("join_available"));
    $("btnAgregarPokemon").addEventListener("click",()=>addPokemon($("pokemonEquipoInput").dataset.pokemonId||$("pokemonEquipoInput").value));
    $("pokemonEquipoInput").addEventListener("input",e=>showBattlePokemonSuggestions(e.target.value));
    $("pokemonEquipoInput").addEventListener("keydown",e=>{
        const list=$("battlePokemonSuggestions"),options=[...list.querySelectorAll(".battle-search-option")],current=options.findIndex(option=>option.classList.contains("active"));
        if(e.key==="ArrowDown"&&options.length){e.preventDefault();options[(current+1)%options.length].focus();}
        else if(e.key==="ArrowUp"&&options.length){e.preventDefault();options[(current<=0?options.length:current)-1].focus();}
        else if(e.key==="Enter"){
            e.preventDefault();
            if(!list.classList.contains("oculto")&&options.length){(options[current>=0?current:0]).click();}
            else addPokemon(e.target.dataset.pokemonId||e.target.value);
        } else if(e.key==="Escape")list.classList.add("oculto");
    });
    $("battlePokemonSuggestions").addEventListener("keydown",e=>{
        const options=[...$("battlePokemonSuggestions").querySelectorAll(".battle-search-option")],current=options.indexOf(document.activeElement);
        if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();options[(current+(e.key==="ArrowDown"?1:options.length-1))%options.length]?.focus();}
        else if(e.key==="Escape"){$("battlePokemonSuggestions").classList.add("oculto");$("pokemonEquipoInput").focus();}
    });
    document.addEventListener("click",e=>{if(!e.target.closest(".team-search"))$("battlePokemonSuggestions").classList.add("oculto");});
    $("btnEquipoRandom").addEventListener("click",fillRandom);
    $("btnListo").addEventListener("click",async()=>{
        if(!team.length){showNotice("Agrega al menos un Pokémon.");return;}
        if(mode==="cpu"){
            const btn=$("btnListo");btn.disabled=true;try{const cpuTeam=[];for(let i=0;i<team.length;i++)cpuTeam.push(await randomPokemon([...team.map(p=>p.id),...cpuTeam.map(p=>p.id)]));const chart=await typeChart([...team,...cpuTeam]);room="CPU";roomState={phase:"in_battle",typeChart:chart,spectators:[],players:[{socketId:"local",name:trainer||"Tú",team:structuredClone(team),activeIndex:0},{socketId:"cpu",name:"CPU",team:cpuTeam,activeIndex:0}],cpu:true};showView("vistaBatalla");renderBattle(roomState,[`¡Un entrenador CPU te reta! ${team[0].name}, ¡yo te elijo!`]);}catch(e){showNotice(e.message);}finally{btn.disabled=false;}return;
        }
        const btn=$("btnListo");btn.disabled=true;try{const chart=await typeChart(team);send("ready",{team,typeChart:chart});setText("estadoSala","Esperando al otro jugador…");}finally{btn.disabled=false;}
    });
    $("btnSalirSala").addEventListener("click",()=>send("leave_room"));$("btnDejarEspectador").addEventListener("click",()=>send("leave_room"));

    async function typeChart(roster) { const names=[...new Set(roster.flatMap(p=>p.moves.map(m=>m.type)))];const result={};await Promise.all(names.map(async name=>{try{const data=await api(`${API}/type/${name}`);result[name]=data.damage_relations;}catch{result[name]={};}}));return result; }
})();
