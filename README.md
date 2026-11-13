# Pool Three
An incremental game about three unknown materials at the bottom of a reactor pool. Forked from seihoukei/generator; the original 2017 game is kept, playable, in `legacy/`.

## Running it

```
npm install
npm run build      # bundles the game into build/game.js
```

Then serve this folder with any static web server and open `index.html`.

- `npm test` runs the simulation tests.
- `npm run balance` plays a whole shift with a scripted operator and prints when each story beat is reached.
- `sim/` is the simulation (no DOM), `display/` is the interface, `design/` holds design notes.
