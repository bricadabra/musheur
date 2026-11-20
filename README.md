# Musheur

Where and when to go mushroom foraging in France's public forests: a 0–100
index per forest, today to six days out, from rain, soil moisture and soil
temperature. No account, no server: the data, weather included, is static
files refreshed every day in
[musheur-cdn](https://github.com/bricadabra/musheur-cdn).

**→ <https://bricadabra.github.io/musheur/>** · a [Bricadabra](https://github.com/bricadabra) project

## Run it

```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm test
pnpm build
```

`VITE_CDN=http://localhost:4000 pnpm dev` reads the data from a local copy
instead of the published one.

Push to `main` publishes to GitHub Pages.

## The index

Rain from one to three weeks ago, soil that stayed damp since, and soil
temperature: one factor at zero zeroes the index, frost cancels it. Model in
`src/score.js`. It ranks days and places; it does not predict a harvest.

**No species identification**: have every harvest checked by a pharmacist or a
mycological society.

## Licence

MIT for the code. Data keeps its own licences, credited on the map: ONF and
IGN (Licence Ouverte 2.0), weather by [Open-Meteo](https://open-meteo.com/)
(CC BY 4.0).
