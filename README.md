# ♠ Poker Afregning

En lille PWA til pokeraftener: registrér hvad hver spiller køber ind for, tæl chips op til sidst,
og få en liste over hvem der skal overføre hvad til hvem (med så få overførsler som muligt).

- Ingen server eller database — alt gemmes lokalt på telefonen (`localStorage`).
- Virker offline og kan installeres på hjemmeskærmen.
- Ren HTML/CSS/JS, intet build-trin.

## Sådan bruges den

1. **Indkøb** — tilføj spillere. Hver får automatisk ét standardindkøb. Tryk *+ Indkøb* ved rebuy,
   eller *+ Andet beløb* for et skævt beløb. Tryk på et indkøb for at fjerne det.
2. **Optælling** — skriv hvor mange chips hver spiller har tilbage. Appen tjekker at det går op.
3. **Afregning** — se overførslerne og del dem i gruppechatten.

Under ⚙︎ kan du sætte hvad ét indkøb koster, og hvor mange chips det giver (fx 100 kr = 1000 chips).

## Hosting på Render (gratis)

New → **Static Site** → vælg dette repo, og udfyld:

| Felt | Værdi |
| --- | --- |
| Branch | `main` |
| Root Directory | *(tom)* |
| Build Command | *(tom)* |
| Publish Directory | `.` |

## Lokal test

```bash
python3 -m http.server 8000
```

Åbn derefter http://localhost:8000.
