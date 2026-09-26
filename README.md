# Hark Primetime — concept site

A Hark Digital concept direction, built from `Hark Concept Starter`
(see `../HARK-CONCEPT-PLAYBOOK.md`).

**Live:** https://harkdigital.github.io/hark-primetime/

**The idea:** a night American-football game shot like a live network
broadcast. One floodlit stadium lives in the shared world; every chapter is a
broadcast segment filmed inside it, with AR graphics keyed onto the turf, the
video board, the LED ribbon, and a replay-stinger cut between segments.

| Chapter | Label | Segment |
|---|---|---|
| hero | Kickoff | the lights come on bank by bank, a skycam dive, the ball on the tee at the 35 |
| work | Highlights | six replays on the video board, then the nine other clients on the ribbon |
| services | Starting Eleven | eleven services = eleven players in formation; the telestrator draws each assignment |
| voices | The Crowd | a card stunt in the stands spells each client, one quote at a time |
| shield | Goal-Line Stand | red-zone threat, the defense holds the goal line, 24/7 |
| process | The Drive | four plays down the field (Listen → Support), stats on the board |
| contact | Touchdown | the score, the end zone, say hello, FINAL |

| | |
|---|---|
| Rendering | floodlit night stadium (analytic turf lines, ~45k-fan crowd as points, LED ribbon, light towers with anamorphic streaks + volumetric beams, video board), broadcast AR, broadcast grade |
| Palette / type | night navy, chalk, first-down yellow `#ffd23f` (accent), AR blue for the line of scrimmage, red-zone red for the hack; Barlow Condensed 800 italic + Barlow + Chivo Mono |
| Cut | replay stinger: a navy band with yellow/white speed stripes sweeps across, the mark rides through |
| Motion | skycam dives, sideline dollies, jib rises, whip-pans, telestrator strokes, board wipes, card-stunt flips |

```bash
npm install
npm run dev
npm run build
```

Dev ports: 6380 (HMR) / 6390 (no HMR, screenshots).
Debug: `?cam=px,py,pz,tx,ty,tz[,fov]` pins the camera (world scouting);
`scripts/shot.mjs --cam=… --eval="js"`.
