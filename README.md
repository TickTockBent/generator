# generator
An incremental game about a three-core reactor. Forked from seihoukei/generator; the original 2017 game is kept, playable, in `legacy/`.

## Running it

```
npm install
npm run build      # bundles the game into build/game.js
```

Then serve this folder with any static web server and open `index.html`.

- `npm test` runs the simulation tests.
- `npm run balance` prints how scripted players do at different rail settings.
- `sim/` is the simulation (no DOM), `display/` is the interface, `design/` holds design notes.
