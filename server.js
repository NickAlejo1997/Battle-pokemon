const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { WebSocketServer, WebSocket } = require("ws");

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const rooms = new Map();
const clients = new Map();
const sockets = new Map();
const getClient = id => [...clients.values()].find(client => client.ws.id === id);
const mime = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".json":"application/json; charset=utf-8", ".png":"image/png", ".svg":"image/svg+xml" };

const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
    const requested = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
    const file = path.resolve(ROOT, `.${requested}`);
    if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, "index.html")) { res.writeHead(403); res.end("Forbidden"); return; }
    fs.readFile(file, (error, data) => {
        if (error) { res.writeHead(error.code === "ENOENT" ? 404 : 500); res.end("Not found"); return; }
        res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream", "X-Content-Type-Options":"nosniff" });
        res.end(data);
    });
});

const wss = new WebSocketServer({ server, maxPayload: 1024 * 1024 });
function send(ws, data) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }
function roomFor(id) { return rooms.get(id); }
function playerFor(room, socketId) { return room.players.find(p => p.socketId === socketId); }
function spectators(room) { return [...room.spectators].map(id => ({ name: getClient(id)?.name || "Espectador" })); }
function publicState(room) {
    const status=room.phase==="finished"?"finished":room.phase==="in_battle"?"in_battle":room.players.length<2?"waiting_opponent":room.ready.size?"waiting_ready":"selecting_team";
    return { roomId:room.id, phase:room.phase, status, players:room.players, ready:[...room.ready], spectators:spectators(room), typeChart:room.typeChart || {}, log:room.log.slice(-12), actionsPending:room.actions.size, winner:room.winner || null };
}
function roomList() { return [...rooms.values()].filter(r => r.phase !== "finished").map(r => ({ roomId:r.id, phase:r.phase === "in_battle" ? "in_battle" : r.players.length>=2 ? "preparing" : "waiting_players", playerCount:r.players.length, playerNames:r.players.map(p=>p.name), spectatorCount:r.spectators.size })); }
function publishRooms() { const message={ type:"rooms", rooms:roomList() }; for(const [ws] of clients) send(ws,message); }
function publishRoom(room, type="room_state", extra={}) {
    const data={type,state:publicState(room),...extra};
    [...room.players.map(p=>p.socketId),...room.spectators].forEach(id=>send(sockets.get(id),data));
    publishRooms();
}
function notifyError(ws,message) { send(ws,{type:"error",message}); }
function addLog(room,text) { room.log.push({text,at:Date.now()});if(room.log.length>40)room.log.shift(); }

function makeRoom(socket,name) {
    const id=Math.random().toString(36).slice(2,7).toUpperCase();
    const room={id,phase:"waiting_players",players:[{socketId:socket.id,name,team:[],activeIndex:0}],spectators:new Set(),ready:new Set(),actions:new Map(),typeChart:{},log:[],winner:null};
    rooms.set(id,room);clients.get(socket).roomId=id;clients.get(socket).role="player";
    send(socket,{type:"joined",roomId:id,role:"player",socketId:socket.id,state:publicState(room)});publishRoom(room);return room;
}
function joinPlayer(socket,room) {
    if(room.players.length>=2 || room.phase!=="waiting_players")return false;
    room.players.push({socketId:socket.id,name:clients.get(socket)?.name||"Entrenador",team:[],activeIndex:0});
    clients.get(socket).roomId=room.id;clients.get(socket).role="player";
    send(socket,{type:"joined",roomId:room.id,role:"player",socketId:socket.id,state:publicState(room)});publishRoom(room);return true;
}
function joinSpectator(socket,room) {
    if(room.phase!=="in_battle")return false;
    room.spectators.add(socket.id);clients.get(socket).roomId=room.id;clients.get(socket).role="spectator";
    send(socket,{type:"joined",roomId:room.id,role:"spectator",socketId:socket.id,state:publicState(room),sync_state:publicState(room)});
    publishRoom(room,"spectators_updated",{spectators:spectators(room)});return true;
}
function active(player) { return player.team[player.activeIndex || 0]; }
function effect(moveType, defender, chart) {
    let value=1; const relation=chart[moveType] || {};
    for(const type of defender.types || []) {
        if((relation.no_damage_to||[]).some(x=>x.name===type))value*=0;
        else if((relation.half_damage_to||[]).some(x=>x.name===type))value*=.5;
        else if((relation.double_damage_to||[]).some(x=>x.name===type))value*=2;
    }
    return value;
}
function attack(attacker,defender,move,room) {
    if(!move)return {text:`${attacker.name} no puede usar ese movimiento.`,missed:true,damage:0,effectiveness:1,critical:false};
    if(move.ppLeft<=0)return {text:`${move.name} no tiene PP.`,missed:true,damage:0,effectiveness:1,critical:false};
    move.ppLeft--;
    const hpBefore=defender.currentHp;
    if(Math.random()*100>Number(move.accuracy||100))return {text:`¡El ataque de ${attacker.name} falló!`,missed:true,damage:0,effectiveness:1,critical:false,hpBefore,hpAfter:defender.currentHp};
    const physical=move.damageClass==="physical";
    const atk=physical?attacker.stats.attack:attacker.stats.specialAttack;
    const def=Math.max(1,physical?defender.stats.defense:defender.stats.specialDefense);
    const stab=attacker.types.includes(move.type)?1.5:1;
    const type=effect(move.type,defender,room.typeChart);
    const critical=Math.random()<(attacker.stats.speed>=100?.15:.10)?1.5:1;
    const base=(((2*50/5+2)*move.power*(atk/def))/50)+2;
    const damage=Math.max(type===0?0:1,Math.floor(base*stab*type*critical*(.85+Math.random()*.15)));
    defender.currentHp=Math.max(0,defender.currentHp-damage);
    let message=`${attacker.name} usó ${move.name}. `;
    if(type===0)message+=`No afecta a ${defender.name}…`;
    else { if(critical>1)message+="¡Un golpe crítico! ";if(type>=2)message+="¡Es súper eficaz! ";else if(type>0&&type<1)message+="No es muy eficaz… ";message+=`${defender.name} perdió ${damage} PS.`; }
    if(defender.currentHp===0)message+=` ¡${defender.name} se debilitó!`;
    return {text:message,missed:false,damage,effectiveness:type,critical:critical>1,hpBefore,hpAfter:defender.currentHp};
}
function livingIndex(player) { return player.team.findIndex(p=>p.currentHp>0); }
function finishCheck(room) {
    const out=room.players.findIndex(p=>livingIndex(p)<0);
    if(out>=0){room.phase="finished";room.winner=room.players[1-out]?.name||"";addLog(room,`${room.winner} ganó el combate.`);return true;}return false;
}
function switchAction(player,action,room) {
    const target=Number(action.index);
    if(!Number.isInteger(target)||!player.team[target]||target===player.activeIndex||player.team[target].currentHp<=0)return `${player.name} no puede cambiar a ese Pokémon.`;
    const from=active(player)?.id;player.activeIndex=target;return {text:`${player.name} cambió a ${player.team[target].name}.`,fromPokemonId:from,toPokemonId:player.team[target].id,toIndex:target};
}
function resolveRound(room) {
    const ordered=room.players.map((p,i)=>({player:p,action:room.actions.get(p.socketId),index:i}));
    room.actions.clear();
    if(ordered.length!==2)return;
    const [a,b]=ordered; let first=a,second=b;
    const aSwitch=a.action?.kind==="switch",bSwitch=b.action?.kind==="switch";
    if(aSwitch&&!bSwitch){first=a;second=b;} else if(bSwitch&&!aSwitch){first=b;second=a;}
    else { const speedA=active(a.player)?.stats?.speed||0,speedB=active(b.player)?.stats?.speed||0; if(speedB>speedA||(speedB===speedA&&Math.random()<.5)){first=b;second=a;} }
    const events=[];
    for(const item of [first,second]){
        if(room.phase!=="in_battle")break;
        if(item.action?.kind==="switch"){const switched=switchAction(item.player,item.action,room);addLog(room,switched.text);events.push({kind:"switch",playerIndex:item.index,toIndex:switched.toIndex,fromPokemonId:switched.fromPokemonId,toPokemonId:switched.toPokemonId,text:switched.text});continue;}
        const attacker=active(item.player);if(!attacker||attacker.currentHp<=0){addLog(room,`${item.player.name} no pudo atacar porque su Pokémon está debilitado.`);continue;}
        const defender=active(room.players[1-item.index]);if(!defender||defender.currentHp<=0)continue;
        const move=item.action?.kind==="struggle"?{name:"Forcejeo",type:"normal",power:50,accuracy:100,ppLeft:Infinity,damageClass:"physical"}:attacker.moves[Number(item.action?.moveIndex)],hpBefore=defender.currentHp,result=attack(attacker,defender,move,room);addLog(room,result.text);
        events.push({kind:"attack",playerIndex:item.index,defenderIndex:1-item.index,attackerName:attacker.name,attackerPokemonId:attacker.id,defenderName:defender.name,defenderPokemonId:defender.id,moveName:move?.name||"movimiento",missed:result.missed,damage:result.damage,effectiveness:result.effectiveness,critical:result.critical,hpBefore:result.hpBefore??hpBefore,hpAfter:result.hpAfter??defender.currentHp});
        if(finishCheck(room))break;
    }
    if(room.phase==="in_battle"){
        for(const p of room.players){const activePokemon=active(p);if(activePokemon?.currentHp===0&&livingIndex(p)>=0)addLog(room,`${p.name}, elige el siguiente Pokémon.`);}
    }
    publishRoom(room,"battle_state",{log:room.log.slice(-8),events});
}
function leaveRoom(socket,disconnected=false) {
    const client=clients.get(socket);if(!client?.roomId)return;
    const room=roomFor(client.roomId);client.roomId=null;client.role=null;if(!room)return;
    if(room.spectators.delete(socket.id)){
        if(!disconnected)send(socket,{type:"left"});publishRoom(room,"spectators_updated",{spectators:spectators(room)});return;
    }
    const index=room.players.findIndex(p=>p.socketId===socket.id);
    if(index>=0){const departed=room.players[index];room.players.splice(index,1);room.ready.delete(socket.id);room.actions.delete(socket.id);if(room.phase==="in_battle"){room.phase="finished";room.winner=room.players[0]?.name||"";addLog(room,`${departed.name} salió de la batalla.`);}if(!disconnected)send(socket,{type:"left"});if(room.players.length===0)rooms.delete(room.id);else publishRoom(room,room.phase==="finished"?"battle_state":"room_state",{log:room.log.slice(-8)});}
    publishRooms();
}

wss.on("connection",ws=>{
    ws.id=`p${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`;clients.set(ws,{ws,name:`Entrenador #${Math.floor(100+Math.random()*900)}`,roomId:null,role:null});sockets.set(ws.id,ws);
    send(ws,{type:"rooms",rooms:roomList()});
    ws.on("message",raw=>{
        let msg;try{msg=JSON.parse(raw.toString());}catch{return notifyError(ws,"Mensaje no válido.");}
        const client=clients.get(ws);if(!client)return;
        if(msg.type==="identify"){client.name=String(msg.name||client.name).trim().slice(0,24)||client.name;const room=roomFor(client.roomId);const player=room&&playerFor(room,ws.id);if(player)player.name=client.name;publishRooms();return;}
        if(msg.type==="create_room"){if(client.roomId)leaveRoom(ws);makeRoom(ws,client.name);return;}
        if(msg.type==="join_available"){const room=[...rooms.values()].find(r=>r.phase==="waiting_players"&&r.players.length===1);if(!room)return notifyError(ws,"No hay salas esperando rival.");joinPlayer(ws,room);return;}
        if(msg.type==="join_room"){const room=roomFor(String(msg.roomId||""));if(!room)return notifyError(ws,"La sala ya no existe.");if(!joinPlayer(ws,room))return notifyError(ws,"La sala está llena o la batalla ya empezó.");return;}
        if(msg.type==="spectate"){const room=roomFor(String(msg.roomId||""));if(!room||!joinSpectator(ws,room))return notifyError(ws,"La batalla ya no está disponible para espectadores.");return;}
        if(msg.type==="leave_room"){leaveRoom(ws);return;}
        const room=roomFor(client.roomId);
        if(!room)return notifyError(ws,"Primero debes entrar a una sala.");
        const isPlayer=room.players.some(p=>p.socketId===ws.id)&&client.role==="player";
        if(["ready","select_move","switch_pokemon","surrender"].includes(msg.type)&&!isPlayer)return;
        const player=playerFor(room,ws.id);
        if(msg.type==="ready"){
            if(!player||room.phase==="in_battle")return;
            if(room.ready.has(ws.id))return;
            if(!Array.isArray(msg.team)||msg.team.length<1||msg.team.length>6)return notifyError(ws,"El equipo debe tener entre 1 y 6 Pokémon.");
            player.team=msg.team.map(p=>({...p,currentHp:p.maxHp,moves:(p.moves||[]).map(m=>({...m,ppLeft:m.pp}))}));room.typeChart={...room.typeChart,...(msg.typeChart||{})};room.ready.add(ws.id);
            room.phase=room.players.length===2?"ready":"waiting_players";
            addLog(room,`${player.name} está listo.`);
            if(room.players.length===2&&room.players.every(p=>room.ready.has(p.socketId))){room.phase="in_battle";addLog(room,"¡Comienza el combate!");publishRoom(room,"battle_state",{log:room.log.slice(-8),events:[]});}else publishRoom(room);
            return;
        }
        if(msg.type==="surrender"){
            if(room.phase!=="in_battle"||!player)return;
            room.phase="finished";room.winner=room.players.find(p=>p.socketId!==ws.id)?.name||"";addLog(room,`${player.name} se rindió. ${room.winner} ganó el combate.`);publishRoom(room,"battle_state",{log:room.log.slice(-8),events:[]});return;
        }
        if(msg.type==="select_move"||msg.type==="switch_pokemon"){
            if(room.phase!=="in_battle"||!player||room.actions.has(ws.id))return;
            const action=msg.action||{};action.kind=msg.type==="select_move"?"move":"switch";
            if(action.kind==="move"){
                if(!Number.isInteger(Number(action.moveIndex)))return;
                const current=active(player),moveIndex=Number(action.moveIndex);
                if(!current||current.currentHp<=0)return notifyError(ws,"Debes elegir un Pokémon de reemplazo.");
                if(moveIndex===-1&&current.moves.every(m=>m.ppLeft<=0))action.kind="struggle";
                else if(!current.moves[moveIndex]||current.moves[moveIndex].ppLeft<=0)return notifyError(ws,"Ese movimiento no tiene PP.");
            }
            if(action.kind==="switch"){
                if(!Number.isInteger(Number(action.index)))return;
                const target=Number(action.index),current=active(player);
                if(!player.team[target]||target===player.activeIndex||player.team[target].currentHp<=0)return notifyError(ws,"Elige otro Pokémon que siga en pie.");
            }
            room.actions.set(ws.id,action);send(ws,{type:"room_state",state:publicState(room)});
            if(room.actions.size===2)resolveRound(room);else addLog(room,`${player.name} eligió su acción.`);
            return;
        }
    });
    ws.on("close",()=>{leaveRoom(ws,true);clients.delete(ws);sockets.delete(ws.id);publishRooms();});
});

server.listen(PORT,HOST,()=>{
    console.log(`Pokédex Battle disponible en http://localhost:${PORT}`);
    const addresses=Object.values(os.networkInterfaces()).flat().filter(x=>x&&!x.internal&&x.family==="IPv4").map(x=>x.address);
    if(addresses.length)console.log(`En la red Wi-Fi: ${addresses.map(ip=>`http://${ip}:${PORT}`).join(" | ")}`);
});
