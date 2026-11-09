# IncidentCard

Why a car went out, in plain words: band with the status and location, the entry, a sentence, a short input trace, three facts and actions.

**Provide**: an `Incident` from `lib/incidents.ts`: `carId`, `t`, `lap`, `corner`, `impactKmh`, `cause` (`power-oversteer`, `wrong-way`, `brake-lock`, `ecu-failure`, `stalled`, `time-up`), `sentence`, and the frame window for the trace.

- The sentence is generated from the frames by fixed templates (what, where, speed, what followed) and is reproducible; no free text from a model.
- The trace shows speed (entry colour) over the last 18 s with throttle as a band underneath and a SPIN marker where yaw rate spikes.
- Actions: "Replay from" seeks 15 s before the crash in TV camera on that car; "On the map" switches to the map camera with the pin; "Its code" opens the entry page at the driver code.
- Opens from the timeline marker, the race message, the tower row of a retired car, or the classification. Phone: a sheet.
- ECU failure (driver code errors) shows the error text in mono instead of the trace.

Maps to `<IncidentCard incident>`.
