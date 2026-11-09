# CarLabel

Labels drawn over the 3D scene: `CarLabel` for one car, `PackLabel` for overlapping cars, `IncidentPin` for a crash point.

**Provide** to `CarLabel`: `entry`, `position`, `focused`, `ghost`, `out`, and the projected screen point (from `Driver.tsx`).
**Provide** to `PackLabel`: the pack (`lib/pack.ts`: car ids in running order, groups at identical positions).

- A label is position plus code; the focused car adds its full name and a chalk ring.
- Labels stack upward on collision (`stackLabels`); the car itself never moves.
- When cars are closer than 1.5 car lengths their labels merge into one PackLabel, listing chips in running order. Cars at identical positions join with `=` and "same line".
- Ghost cars (inside a pack, not the focused car) get an outlined code instead of a filled one.
- Hidden in onboard and chase for the focused car, and beyond 900 m from the camera.

Maps to `<CarLabel>`, `<PackLabel>`, `<IncidentPin>`.
