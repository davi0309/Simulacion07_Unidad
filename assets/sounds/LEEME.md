# Sonidos opcionales

El proyecto NO necesita archivos aquí: todos los sonidos se sintetizan en `audio.js`.

Si quieres reemplazar alguno por un archivo propio (por ejemplo, de Freesound con licencia de otra cosa),
cópialo  en esta carpeta y regístralo en `sounds.jsonc`:

```json
{
  "H": "raices.mp3",
  "A": "patronus.mp3",
  "RR": "electricidad.mp3",
  "RR_off": "electricidad_fin.mp3",
  "Y": "chispas.mp3",
  "P": "dementores.mp3",
  "O": "aranas.mp3",
  "TT": "pelo.mp3",
  "E": "piedra.mp3",
  "RF": "levitar.mp3"
}
```

Las claves `_off` son el sonido del contrahechizo (opcional). Si un archivo falta o no carga,
se usa el sonido sintetizado y la experiencia sigue funcionando.
