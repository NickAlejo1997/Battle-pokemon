# Pokédex y juego de batallas

La Pokédex original sigue disponible en la página. Pulsa **Empezar a Jugar** para abrir el centro de batalla.

## Iniciar el servidor

Requiere Node.js y acceso a internet para consultar la PokéAPI.

```bash
npm install
npm start
```

Abre `http://localhost:3000`. El servidor también imprime las direcciones IPv4 de la red local; desde otros dispositivos conectados al mismo Wi-Fi, abre `http://IP-DEL-ANFITRIÓN:3000`. El puerto del servidor WebSocket es el mismo, `3000`.

El anfitrión debe mantener el servidor en ejecución durante las partidas online. Cada sala mantiene su propio combate y admite espectadores en vivo.
