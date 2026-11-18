// ================================================
//  Pokédex - Consumo de la API REST PokeAPI
//  Documentación: https://pokeapi.co/docs/v2
// ================================================

const API_URL = "https://pokeapi.co/api/v2";
const TOTAL_POKEMON = 1025;

let idActual = null;      // número del Pokémon que se está mostrando
let ultimoJson = null;    // última respuesta JSON recibida

// Traducción de tipos al español
const TIPOS = {
    normal:   { nombre: "Normal",    color: "#A8A77A" },
    fire:     { nombre: "Fuego",     color: "#EE8130" },
    water:    { nombre: "Agua",      color: "#6390F0" },
    electric: { nombre: "Eléctrico", color: "#F7D02C" },
    grass:    { nombre: "Planta",    color: "#7AC74C" },
    ice:      { nombre: "Hielo",     color: "#96D9D6" },
    fighting: { nombre: "Lucha",     color: "#C22E28" },
    poison:   { nombre: "Veneno",    color: "#A33EA1" },
    ground:   { nombre: "Tierra",    color: "#E2BF65" },
    flying:   { nombre: "Volador",   color: "#A98FF3" },
    psychic:  { nombre: "Psíquico",  color: "#F95587" },
    bug:      { nombre: "Bicho",     color: "#A6B91A" },
    rock:     { nombre: "Roca",      color: "#B6A136" },
    ghost:    { nombre: "Fantasma",  color: "#735797" },
    dragon:   { nombre: "Dragón",    color: "#6F35FC" },
    dark:     { nombre: "Siniestro", color: "#705746" },
    steel:    { nombre: "Acero",     color: "#B7B7CE" },
    fairy:    { nombre: "Hada",      color: "#D685AD" }
};

// Traducción de estadísticas al español
const ESTADISTICAS = {
    "hp": "PS",
    "attack": "Ataque",
    "defense": "Defensa",
    "special-attack": "At. Especial",
    "special-defense": "Def. Especial",
    "speed": "Velocidad"
};

// ------------------------------------------------
// 1. Petición GET a la API y conversión a JSON
// ------------------------------------------------
async function obtenerJson(url) {
    const respuesta = await fetch(url);

    if (!respuesta.ok) {               // 404 u otro error HTTP
        throw new Error(`Error ${respuesta.status}`);
    }
    return await respuesta.json();     // texto JSON -> objeto JavaScript
}

// ------------------------------------------------
// 2. Buscar un Pokémon (2 peticiones a la API)
// ------------------------------------------------
async function buscarPokemon(valor) {
    valor = String(valor).trim().toLowerCase();
    if (valor === "") {
        mostrarMensaje("Escribe un número o nombre", "#e3350d");
        return;
    }

    mostrarMensaje("Cargando...", "#555", true);

    try {
        // Petición 1: datos principales (imagen, tipos, stats)
        const urlPokemon = `${API_URL}/pokemon/${valor}`;
        const pokemon = await obtenerJson(urlPokemon);

        // Petición 2: datos de la especie (nombre y descripción en español)
        const especie = await obtenerJson(pokemon.species.url);

        ultimoJson = pokemon;
        document.getElementById("urlPeticion").textContent = "GET " + urlPokemon;
        actualizarPanelJson();

        await mostrarPokemon(pokemon, especie);
        mostrarMensaje("", "");
    } catch (error) {
        document.getElementById("tarjeta").classList.add("oculto");
        mostrarMensaje(`No se encontró "${valor}" (${error.message})`, "#e3350d");
    }
}

// ------------------------------------------------
// 3. Pintar los datos del JSON en el HTML
// ------------------------------------------------
async function mostrarPokemon(pokemon, especie) {
    idActual = pokemon.id;

    // Nombre en español (si existe)
    const nombreEs = especie.names.find(n => n.language.name === "es");
    document.getElementById("nombre").textContent = nombreEs ? nombreEs.name : pokemon.name;
    document.getElementById("numero").textContent = "#" + String(pokemon.id).padStart(4, "0");

    // Imagen oficial
    const imagen = pokemon.sprites.other["official-artwork"].front_default
                   || pokemon.sprites.front_default;
    document.getElementById("imagen").src = imagen;

    // Tipos
    const contenedorTipos = document.getElementById("tipos");
    contenedorTipos.innerHTML = "";
    pokemon.types.forEach(t => {
        const tipo = TIPOS[t.type.name] || { nombre: t.type.name, color: "#777" };
        contenedorTipos.innerHTML += `<span class="tipo" style="background:${tipo.color}">${tipo.nombre}</span>`;
    });

    // ------------------------------------------------
    // Relaciones de tipo: fuerte / débil / neutral
    // En la API cada relación es un objeto { name, url }, así que hay que
    // quedarse con .name (si no, al imprimirlo sale "[object Object]").
    // ------------------------------------------------
    const relacionesTipo = await Promise.all(
        pokemon.types.map(t => obtenerRelacionesTipo(t.type.name))
    );

    const tiposPropios = pokemon.types.map(t => t.type.name);

    const fuertes = [];      // este Pokémon causa x2 o más
    const debiles = [];      // este Pokémon recibe x2 o más
    const neutrales = [];    // resiste (x0.5) o es inmune (x0)

    for (const tipo of Object.keys(TIPOS)) {
        if (tiposPropios.includes(tipo)) continue;   // los tipos propios no cuentan

        // En pokémons de dos tipos los multiplicadores se multiplican entre sí
        let hacia = 1;    // daño que causa este Pokémon al tipo
        let desde = 1;    // daño que recibe este Pokémon del tipo

        for (const rel of relacionesTipo) {
            hacia *= multiplicador(rel, tipo, "to");
            desde *= multiplicador(rel, tipo, "from");
        }

        if (hacia >= 2) fuertes.push({ tipo, mult: hacia });
        if (desde >= 2) debiles.push({ tipo, mult: desde });
        if (hacia < 1 || desde < 1) neutrales.push({ tipo, mult: Math.min(hacia, desde) });
    }

    // Un tipo que ya es fuerte o débil no se repite como neutro
    const yaClasificados = [...fuertes, ...debiles].map(r => r.tipo);
    const soloNeutrales = neutrales.filter(r => !yaClasificados.includes(r.tipo));

    document.getElementById("fortalezas").innerHTML = fuertes.length > 0
        ? `<strong>Fuerte contra:</strong> ${pintarTipos(fuertes)}`
        : `<strong>Fuerte contra:</strong> <span class="vacio">Ninguno</span>`;

    document.getElementById("debilidades").innerHTML = debiles.length > 0
        ? `<strong>Débil contra:</strong> ${pintarTipos(debiles)}`
        : `<strong>Débil contra:</strong> <span class="vacio">Ninguno</span>`;

    document.getElementById("neutros").innerHTML = soloNeutrales.length > 0
        ? `<strong>Neutral contra:</strong> ${pintarTipos(soloNeutrales)}`
        : `<strong>Neutral contra:</strong> <span class="vacio">Ninguno</span>`;

    // Descripción en español
    const textoEs = especie.flavor_text_entries.find(f => f.language.name === "es");
    document.getElementById("descripcion").textContent = textoEs
        ? textoEs.flavor_text.replace(/[\n\f]/g, " ")
        : "Sin descripción en español.";

    // Altura (decímetros -> metros) y peso (hectogramos -> kg)
    document.getElementById("altura").textContent = (pokemon.height / 10) + " m";
    document.getElementById("peso").textContent = (pokemon.weight / 10) + " kg";

    // Estadísticas con barras
    const contenedorStats = document.getElementById("estadisticas");
    contenedorStats.innerHTML = "";
    pokemon.stats.forEach(s => {
        const porcentaje = Math.min(s.base_stat / 200 * 100, 100);
        contenedorStats.innerHTML += `
            <div class="stat">
                <span>${ESTADISTICAS[s.stat.name] || s.stat.name}</span>
                <strong>${s.base_stat}</strong>
                <div class="barra"><div style="width:${porcentaje}%"></div></div>
            </div>`;
    });

    document.getElementById("tarjeta").classList.remove("oculto");
}

// ------------------------------------------------
// Obtener relaciones de tipo (debilidades/fortalezas)
// ------------------------------------------------
async function obtenerRelacionesTipo(nombreTipo) {
    const datos = await obtenerJson(`${API_URL}/type/${nombreTipo}`);
    return datos.damage_relations;
}

// Multiplicador de daño de un tipo frente a otro: 2, 0.5, 0 o 1
function multiplicador(relacion, tipo, sentido) {
    if (relacion[`no_damage_${sentido}`].some(r => r.name === tipo)) return 0;
    if (relacion[`half_damage_${sentido}`].some(r => r.name === tipo)) return 0.5;
    if (relacion[`double_damage_${sentido}`].some(r => r.name === tipo)) return 2;
    return 1;
}

// Pintar una lista de tipos como etiquetas de color
function pintarTipos(lista) {
    return lista.map(({ tipo, mult }) => {
        const info = TIPOS[tipo] || { nombre: tipo, color: "#777" };
        const factor = mult !== 1 ? ` <small>x${mult}</small>` : "";
        return `<span class="tipo" style="background:${info.color}">${info.nombre}${factor}</span>`;
    }).join(" ");
}

// ------------------------------------------------
// 4. Utilidades
// ------------------------------------------------
function mostrarMensaje(texto, color, cargando = false) {
    const mensaje = document.getElementById("mensaje");
    mensaje.textContent = texto;
    mensaje.style.color = color;
    mensaje.classList.toggle("cargando", cargando);
}

function actualizarPanelJson() {
    document.getElementById("json").textContent = JSON.stringify(ultimoJson, null, 2);
}

// ------------------------------------------------
// 5. Autocompletado (sugerencias mientras escribes)
// ------------------------------------------------
let listaPokemon = [];    // [{ id: 25, nombre: "pikachu" }, ...]
let indiceActivo = -1;    // sugerencia marcada con las flechas

// Se descarga UNA sola vez la lista de nombres al cargar la página
async function cargarListaPokemon() {
    const datos = await obtenerJson(`${API_URL}/pokemon-species?limit=${TOTAL_POKEMON}`);
    listaPokemon = datos.results.map(p => ({
        id: Number(p.url.split("/").filter(Boolean).pop()),  // id sacado de la URL
        nombre: p.name
    }));
}

function mostrarSugerencias(texto) {
    const lista = document.getElementById("sugerencias");
    texto = texto.trim().toLowerCase();
    indiceActivo = -1;

    if (texto === "") {
        lista.classList.add("oculto");
        return;
    }

    // Primero los que empiezan con el texto, luego los que lo contienen
    const empiezan = listaPokemon.filter(p => p.nombre.startsWith(texto) || String(p.id) === texto);
    const contienen = listaPokemon.filter(p => !empiezan.includes(p) && p.nombre.includes(texto));
    const resultados = [...empiezan, ...contienen].slice(0, 8);

    if (resultados.length === 0) {
        lista.innerHTML = "<li>Sin resultados</li>";
        lista.classList.remove("oculto");
        return;
    }

    lista.innerHTML = "";
    resultados.forEach(p => {
        const resaltado = p.nombre.replace(texto, `<mark>${texto}</mark>`);
        const sprite = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${p.id}.png`;
        lista.innerHTML += `
            <li data-id="${p.id}">
                <img src="${sprite}" alt="">
                <span>${resaltado}</span>
                <small>#${String(p.id).padStart(4, "0")}</small>
            </li>`;
    });
    lista.classList.remove("oculto");
}

function elegirSugerencia(id) {
    document.getElementById("busqueda").value = "";
    document.getElementById("sugerencias").classList.add("oculto");
    buscarPokemon(id);
}

function marcarSugerencia(items) {
    items.forEach((li, i) => li.classList.toggle("activo", i === indiceActivo));
    if (items[indiceActivo]) items[indiceActivo].scrollIntoView({ block: "nearest" });
}

// ------------------------------------------------
// 6. Eventos
// ------------------------------------------------
const inputBusqueda = document.getElementById("busqueda");

// Cada vez que escribe una letra
inputBusqueda.addEventListener("input", (e) => mostrarSugerencias(e.target.value));

// Flechas arriba/abajo, Enter y Escape
inputBusqueda.addEventListener("keydown", (e) => {
    const items = [...document.querySelectorAll("#sugerencias li[data-id]")];

    if (e.key === "ArrowDown" && items.length) {
        e.preventDefault();
        indiceActivo = (indiceActivo + 1) % items.length;
        marcarSugerencia(items);
    } else if (e.key === "ArrowUp" && items.length) {
        e.preventDefault();
        indiceActivo = (indiceActivo - 1 + items.length) % items.length;
        marcarSugerencia(items);
    } else if (e.key === "Enter") {
        if (items.length) {
            // Si no marcó ninguna con las flechas, toma la primera
            elegirSugerencia(items[Math.max(indiceActivo, 0)].dataset.id);
        } else {
            buscarPokemon(inputBusqueda.value);
        }
    } else if (e.key === "Escape") {
        document.getElementById("sugerencias").classList.add("oculto");
    }
});

// Clic en una sugerencia
document.getElementById("sugerencias").addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-id]");
    if (li) elegirSugerencia(li.dataset.id);
});

// Clic fuera del buscador: cerrar sugerencias
document.addEventListener("click", (e) => {
    if (!e.target.closest(".autocompletar")) {
        document.getElementById("sugerencias").classList.add("oculto");
    }
});

document.getElementById("btnBuscar").addEventListener("click", () => {
    const items = document.querySelectorAll("#sugerencias li[data-id]");
    if (items.length && !document.getElementById("sugerencias").classList.contains("oculto")) {
        elegirSugerencia(items[0].dataset.id);
    } else {
        buscarPokemon(inputBusqueda.value);
    }
});

document.getElementById("btnAleatorio").addEventListener("click", () => {
    const aleatorio = Math.floor(Math.random() * TOTAL_POKEMON) + 1;
    buscarPokemon(aleatorio);
});

document.getElementById("btnAnterior").addEventListener("click", () => {
    if (idActual > 1) buscarPokemon(idActual - 1);
});

document.getElementById("btnSiguiente").addEventListener("click", () => {
    if (idActual < TOTAL_POKEMON) buscarPokemon(idActual + 1);
});

document.getElementById("btnJson").addEventListener("click", () => {
    const pre = document.getElementById("json");
    pre.classList.toggle("oculto");
    document.getElementById("btnJson").textContent =
        pre.classList.contains("oculto") ? "Ver JSON de la respuesta" : "Ocultar JSON";
});

// Al cargar la página: lista para el buscador y mostramos a Pikachu
cargarListaPokemon();
buscarPokemon(25);
