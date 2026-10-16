# Harry Potter: Tipografía Jugable

Experiencia web en tiempo real hecha con **p5.js**. La varita (el mouse) lanza un hechizo distinto sobre cada letra de **HARRY POTTER**. No hay puntos ni niveles: la persona explora libremente y descubre qué hace cada letra.

---

## 1. Estructura del proyecto

```
harry-potter-playable-type/
├── index.html            ← estructura de la página y controles
├── style.css             ← fondo, controles, indicación inicial
├── sketch.js             ← núcleo p5: letras, detección, dibujo 3D, varita, cielo
├── effects.js            ← sistema de partículas + los 9 hechizos
├── audio.js              ← sonidos sintetizados con Web Audio API
├── libs/
│   └── p5.min.js         ← p5.js 1.11.10 (incluido, funciona sin internet)
├── assets/
│   ├── fonts/
│   │   ├── CinzelDecorative-Black.ttf
│   │   └── OFL.txt       ← licencia de la fuente
│   └── sounds/
│       ├── sounds.json   ← registro de sonidos opcionales (vacío por defecto)
│       └── LEEME.md
└── README.md
```

Se añadieron dos archivos JS auxiliares (`effects.js` y `audio.js`) para que `sketch.js` no supere las mil líneas y cada parte sea fácil de modificar.

## 2. Cómo abrirlo en Visual Studio Code

**Opción A — usar la carpeta entregada (recomendado)**

1. Descomprime `harry-potter-playable-type.zip`.
2. En VS Code: **Archivo → Abrir carpeta…** y elige `harry-potter-playable-type`.

**Opción B — crearla a mano**

1. Crea la carpeta `harry-potter-playable-type` y ábrela en VS Code.
2. Crea las subcarpetas `libs`, `assets/fonts` y `assets/sounds` (clic derecho en el explorador → *Nueva carpeta*).
3. Crea `index.html`, `style.css`, `sketch.js`, `effects.js` y `audio.js` (clic derecho → *Nuevo archivo*) y pega el contenido de cada uno.
4. Descarga los recursos de la sección 3 y colócalos en su carpeta.
5. Crea `assets/sounds/sounds.json` con el contenido `{}`.

## 3. Dependencias y recursos externos

| Recurso | Dónde va | Procedencia | Licencia |
|---|---|---|---|
| p5.js 1.11.10 | `libs/p5.min.js` | https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.11.10/p5.min.js | LGPL 2.1 |
| Cinzel Decorative Black | `assets/fonts/` | Google Fonts — https://fonts.google.com/specimen/Cinzel+Decorative | SIL Open Font License 1.1 (`OFL.txt`) |
| Sonidos | — | Sintetizados en `audio.js` (no requieren archivos) | Propios del proyecto |

No hay nada que instalar con npm. Si prefieres el CDN, reemplaza en `index.html` la línea `libs/p5.min.js` por el enlace de cdnjs.

**Sobre la tipografía:** la fuente de los títulos oficiales es una marca registrada y las fuentes "estilo Harry Potter" que circulan no tienen licencia clara. Por eso se usa **Cinzel Decorative**, una serif romana decorativa con terminales caligráficos, libre y con un tono clásico y fantástico. Para cambiarla, coloca otro `.ttf` u `.otf` en `assets/fonts/` y edita `FONT_FILE` en `sketch.js` (p5 1.x no carga `.woff2`).

## 4. Ejecutar con un servidor local

El navegador bloquea la carga de fuentes con `file://`, así que **no abras `index.html` con doble clic**.

1. Instala la extensión **Live Server** (Ritwick Dey) desde el panel de extensiones de VS Code.
2. Clic derecho sobre `index.html` → **Open with Live Server**.
3. Se abre `http://127.0.0.1:5500/`. Haz clic en cualquier letra; el sonido arranca con ese primer clic.

Alternativa sin extensión: en la terminal, dentro de la carpeta, ejecuta `python -m http.server 8000` y abre `http://localhost:8000`.

## 5. Interacciones

| Letra | Hechizo | Tipo |
|---|---|---|
| **H** | Raíces que trepan por el contorno y cuelgan de la base; luego hojas y flores que abren sus pétalos | Transitorio (~11 s) |
| **A** | *Expecto Patronum*: destello azul plateado, partículas en el contorno y espíritus que recorren la silueta, orbitan y se dispersan | Transitorio (~9 s) |
| **R R** (HARRY) | Descargas verdes ramificadas sobre ambos contornos, un rayo que une las dos R, humo oscuro y cambio a verde oscuro | Persistente |
| **Y** | Explosión de chispas desde el contorno, halo dorado que se apaga poco a poco | Transitorio (~5 s) |
| **P** | Sombras espectrales tipo dementor que giran alrededor (por delante y por detrás), niebla, escena que se oscurece y letra que se enfría | Transitorio (~11 s) |
| **O** | Arañas con patas animadas que caminan sobre el trazo, se alejan y regresan | Transitorio (~12 s) |
| **T T** | Ambas T se vuelven criaturas: pelo que se mece, orejas que se mueven, colas que ondulan y ojos que parpadean | Persistente |
| **E** | Tiembla, suelta polvo, se vuelve gris, se agrieta y queda como roca inmóvil | Persistente |
| **R** final | Se eleva, flota oscilando, gira levemente y suelta polvo mágico | Persistente |

**Regla para el siguiente clic (decisión de diseño): hechizo y contrahechizo.**

- **Transitorios (H, A, Y, P, O):** cada clic vuelve a lanzar el hechizo. Puede haber hasta 2 a la vez por letra; si llega un tercero, el más antiguo termina rápido. Así los efectos no se acumulan indefinidamente.
- **Persistentes (RR, TT, E, R final):** el primer clic transforma la letra y la deja así. El siguiente clic lanza el **contrahechizo**, que invierte la transformación con su propia animación y sonido. Si haces clic mientras se está invirtiendo, vuelve a transformarse desde donde iba.
- Las letras hermanas (las dos R de HARRY, las dos T) comparten un mismo estado: un clic en cualquiera de ellas afecta a ambas y, al pasar la varita, se iluminan juntas. Por eso un segundo clic en la *otra* R también invierte el hechizo.
- **Reiniciar** detiene todos los hechizos y devuelve las letras a su estado original.

## 6. Cómo funciona

### Letras como geometría

`sketch.js` usa la fuente cargada por p5 (`font.font`, un objeto de opentype.js). Con ella obtiene el contorno vectorial de cada letra (`getPath`). Por cada letra:

1. **`Path2D`:** la forma exacta, para rellenarla, recortar (*clip*) texturas y dibujar el bisel.
2. **Contornos muestreados:** las curvas se aplanan y se remuestrean con puntos equidistantes (~3 px). Cada punto guarda su **normal hacia afuera**. La dirección se verifica probando si un punto desplazado cae dentro de la letra.
3. **Caja, centro y contorno exterior.**

Todos los efectos salen de esos puntos: las raíces nacen en los puntos de la base cuya normal mira hacia abajo, los rayos recorren tramos de contorno, el pelo crece en dirección de la normal y las arañas avanzan con un parámetro `u` a lo largo del contorno. Las grietas son caminatas aleatorias que entran desde el borde y se recortan a la forma de la letra.

### Detección de clics

`pickLetter(x, y)` aplica dos pasos:

1. **Prueba exacta:** se comprueba si el punto está dentro del trazo (regla par-impar sobre los contornos). Si lo está, gana esa letra.
2. **Desempate:** si el punto no está sobre ningún trazo, se consideran solo las letras cuya caja (con un margen pequeño) lo contiene, y gana la de borde más cercano.

Así un clic nunca activa dos letras, el interior de la O cuenta como O y los espacios entre letras no disparan nada. El punto se transforma primero al sistema local de la letra, de modo que la R que levita sigue siendo clicable donde se ve. Cada letra conoce su índice en la frase, por eso las dos R de HARRY (`RR`) se distinguen de la R final (`RF`).

### Estados

En cada fotograma las letras vuelven a valores neutros (`resetDynamic`) y cada hechizo activo vuelve a escribir lo que necesita: `green`, `stone`, `fur`, `glow`, `oy`, `rot`, `shakeAmt`… Cuando un hechizo termina, la letra queda limpia sin código extra de limpieza, y varios efectos simultáneos se combinan tomando el máximo.

- Los **transitorios** tienen fases de aparición, desarrollo y desvanecimiento (`alpha`).
- Los **persistentes** tienen un valor `amount` (0 → 1) y una bandera `reversing`. El tiempo se mide con `deltaTime`, así la velocidad no depende de los FPS.

### Partículas

`Particles` es un sistema único con un límite global de 2600 partículas. Cada una tiene posición, velocidad, gravedad, arrastre, deriva por ruido de Perlin, vida, tamaño y capa (`back` detrás de las letras, `front` delante). Se dibujan con *sprites* radiales pre-renderizados:

- **Luces** con mezcla aditiva (`lighter`).
- **Humo y polvo** con mezcla normal.

### Apariencia 3D

p5 en modo 2D no extruye texto, así que el volumen se simula:

1. Sombra proyectada difusa.
2. 10–14 copias de la letra desplazadas hacia abajo a la derecha, cada vez más oscuras (extrusión).
3. Cara frontal con degradado vertical.
4. Bisel: dos trazos del contorno, uno claro y otro oscuro, ligeramente desplazados y recortados a la letra.

El modo WEBGL de p5 permitiría geometría real, pero perdería el canvas 2D (Path2D, recortes, mezclas), del que dependen casi todos los efectos. Por eso se eligió la extrusión simulada.

### Audio

`audio.js` crea un `AudioContext` solo después del primer clic, para respetar la política de reproducción automática. Cada hechizo tiene un sonido sintetizado con osciladores, ruido filtrado, envolventes y una reverberación generada. Tiene además:

- Un compresor que evita la saturación.
- Un control anti-repetición: el mismo sonido no se dispara dos veces en menos de 0,18 s.
- Controles de volumen y de silencio.

Si registras archivos en `assets/sounds/sounds.json`, se usan en lugar del sintetizado. Si fallan, se ignoran.

## 7. Análisis de viabilidad (problemas previstos y soluciones)

| Problema | Solución adoptada |
|---|---|
| Detectar clics en letras individuales | Geometría vectorial por letra + prueba exacta dentro/fuera + desempate por cercanía |
| 3D convincente en p5 | Extrusión por capas + degradado + bisel recortado (ver arriba) |
| Partículas que sigan los contornos | Contornos remuestreados con normales; `ptAlong()` para recorridos continuos |
| Coordinar letras relacionadas | Un solo hechizo por grupo (`RR`, `TT`) que recibe ambas letras; rayo "puente" entre las R |
| Audio y autoplay | Contexto creado en el primer clic; síntesis local, sin dependencia de archivos |
| Rendimiento | Límite de partículas, sprites cacheados, pelo dibujado en 3 trazos por color, `deltaTime` |

**Simplificaciones honestas:**

- Las criaturas de las T son "peludas" genéricas (pelo, orejas, cola, ojos), no un animal concreto.
- Los espíritus del Patronus son estelas luminosas, no animales con silueta definida.
- Los dementores son capuchas vaporosas hechas de cadenas de partículas.
- Al redimensionar la ventana se recalcula la geometría y se reinician los hechizos activos.
- Las arañas recorren el contorno exterior de la O. En esta fuente, la O es un trazo caligráfico de un solo contorno.

## 8. Lista de pruebas

1. Al cargar: la frase aparece centrada, con volumen y sombra; el cielo titila; aparece la indicación; la varita sigue al mouse y deja estela.
2. Pasar la varita por cada letra: se ilumina con contorno dorado. Las dos R de HARRY se iluminan juntas, igual que las dos T. Entre letras no se ilumina nada.
3. **H:** las raíces nacen en la base, trepan y cuelgan; aparecen hojas y luego flores que se abren; todo se desvanece hacia los 11 s.
4. **A:** destello azul; los espíritus recorren la silueta, orbitan y se dispersan.
5. **R de HARRY:** las dos R se ponen verdes, aparecen rayos que cambian en cada fotograma y uno que las une, y sale humo. Un nuevo clic las devuelve a blanco.
6. **Y:** estallido de chispas y halo que dura unos segundos.
7. **P:** sombras que pasan por delante y por detrás de la P; la escena se oscurece y luego vuelve.
8. **O:** arañas que aparecen sobre la O, caminan, salen y regresan.
9. **T:** pelo, orejas, colas y ojos en ambas T. Un nuevo clic retrae todo.
10. **E:** tiembla, polvo, piedra, grietas y queda quieta. Un nuevo clic la devuelve a blanco.
11. **R final:** sube y flota sin mover las demás letras; se puede hacer clic sobre ella mientras flota y baja suavemente.
12. Clics rápidos repetidos sobre la misma letra: no se acumulan sin límite.
13. Activar todas las letras a la vez: la animación sigue fluida.
14. Botón de sonido: silencia y reactiva. El deslizador cambia el volumen.
15. **Reiniciar:** todo vuelve al estado inicial y reaparece la indicación.
16. Cambiar el tamaño de la ventana o usar formato vertical: en pantallas estrechas la frase pasa a dos líneas.

## 9. Errores frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| Mensaje "No se pudo cargar la tipografía" | Abriste `index.html` con doble clic (`file://`) o falta el `.ttf` | Usa Live Server y verifica `assets/fonts/CinzelDecorative-Black.ttf` |
| Pantalla negra y error `p5 is not defined` | Falta `libs/p5.min.js` | Descárgalo (sección 3) o usa el enlace del CDN |
| No suena nada | El audio espera el primer clic, o está silenciado | Haz clic en una letra; revisa el botón de sonido y el volumen del sistema |
| `loadFont` falla con otra fuente | p5 1.x no lee `.woff2` | Usa `.ttf` u `.otf` |
| Va lento | Pantalla 4K o equipo sin aceleración gráfica | Baja `MAX` en `Particles` (effects.js) o fija `pixelDensity(1)` en `setup()` |
| Cambié un archivo y no se ve | Caché del navegador | Recarga con Ctrl+F5 |

## 10. Relación con los criterios de evaluación (Unidad 7)

- **Cumplimiento del encargo:** el sistema usa las letras de HARRY POTTER como geometría base. Cada letra se juega de forma independiente y todo corre en tiempo real en la web. El contexto sugerido es una portada web interactiva o una pantalla en un evento.
- **Comprensión y verificación:** el modelo es explícito y fácil de comprobar:
  - estados neutro, transitorio, transformado e invirtiéndose;
  - reglas de clic (repetir vs. contrahechizo);
  - parámetros nombrados (duraciones, tasas de emisión, grosores).
  
  Por ejemplo, si cambias `rate` en `LightningSpell` o `nSeeds` en `RootsSpell`, puedes predecir y observar el cambio.
- **Interacción e identidad:** cada letra revela un rasgo reconocible de ese universo, como la naturaleza mágica, la protección, la magia oscura, el miedo, las criaturas, la transfiguración o la levitación. La regla hechizo/contrahechizo convierte la exploración en "aprender a lanzar y deshacer hechizos". Conviene contrastarlo en las pruebas con compañeros: qué intentaron y qué descubrieron.
- **Resolución tipográfica y experiencia:** la tipografía sigue siendo el centro. Los efectos nacen de los contornos y se recortan a ellos, la frase se mantiene legible y cada efecto tiene inicio, desarrollo y final. El ritmo alterna efectos rápidos (Y, RR) y lentos (P, R final).
