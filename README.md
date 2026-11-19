# Musheur

Where and when to go mushroom foraging in France's public forests: a 0–100
index per forest, today to six days out, from rain, soil moisture and soil
temperature. No account, no server.

**→ <https://bricadabra.github.io/musheur/>** · a [Bricadabra](https://github.com/bricadabra) project

## Run it

```bash
npm install
npm run dev     # http://localhost:3000
npm test
npm run build
```

Push to `main` publishes to GitHub Pages.

## The index

Rain from one to three weeks ago, soil that stayed damp since, and soil
temperature: one factor at zero zeroes the index, frost cancels it. Model in
`src/score.js`. It ranks days and places; it does not predict a harvest.

**No species identification**: have every harvest checked by a pharmacist or a
mycological society.

## Licence

MIT for the code. Datasets keep their own licences, credited on the map.
