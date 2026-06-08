# Mini Metro Clone

A browser-based Mini Metro clone focused on authentic line-dragging feel.

## Play

```bash
python3 -m http.server 8080
```

Open http://localhost:8080

## Controls

- **Drag** from a station to another station to draw a line
- **Drag** from the end of an existing line to extend it
- **Drag** from a line segment to pull a branch and insert a station
- **Space** to pause
- Stations spawn over time; passengers accumulate if trains can't move them
- Game ends when any station exceeds capacity

## Line Drag Feel

- Rubber-hose preview with eased cursor follow
- Smooth cubic-bezier curves matching Mini Metro's track style
- Magnetic snap to nearby stations with visual pulse feedback
- Tangent-aware curves when extending or branching from existing lines
